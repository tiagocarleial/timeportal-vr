import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Experience, Hotspot } from '../../core/models/experience.model';

const EARTH_RADIUS = 1.2;
const MARKER_RADIUS = EARTH_RADIUS + 0.012;
const PANORAMA_RADIUS = 6;
const HOTSPOT_RADIUS = PANORAMA_RADIUS - 0.5;
const XR_GROUP_POSITION = new THREE.Vector3(0, 1.3, -1.6);
const FADE_MS = 380;

// Globe navigation inside immersive VR.
const XR_STICK_DEADZONE = 0.15;
const XR_ROTATE_SPEED = 1.4; // rad/s at full stick deflection
const XR_AUTOROTATE_SPEED = 0.15; // rad/s idle spin
const XR_ZOOM_SPEED = 1.2; // scale factor rate at full deflection
const XR_ZOOM_MIN = 0.45;
const XR_ZOOM_MAX = 2.5;

// Trigger-grab: hold the trigger over empty space and sweep the controller to
// drag the globe around, like grabbing a physical desk globe. Gain > 1 turns a
// comfortable wrist sweep into a full spin; flip the sign of a term if a build
// on real hardware feels reversed.
const XR_GRAB_ROTATE_GAIN = 2.2;
const XR_GRAB_PITCH_MIN = -0.85; // clamp so grabbing never tips past the poles
const XR_GRAB_PITCH_MAX = 0.85;
// Treat a trigger press+release as a "click" (open the marker) only if the
// controller barely moved between them; more than this is read as a drag.
const XR_SELECT_MOVE_TOLERANCE = 0.07; // radians

// Panorama look-around: thumbstick left/right spins the 360 image around you so
// you don't have to physically turn to see behind you.
const XR_PANO_LOOK_SPEED = 1.3; // rad/s at full stick deflection

// In-scene tooltip sizing (world units). The panorama shell is far bigger than
// the globe, so its labels need to be physically larger to read at distance.
const LABEL_HEIGHT_GLOBE = 0.16;
const LABEL_HEIGHT_PANORAMA = 0.75;

const COLOR_INK = 0x181c25;
const COLOR_GRID = 0xc08a3e;
const COLOR_BRASS = 0xd9a857;
const COLOR_ATMOSPHERE = 0x6ea8d8;

const SCENE_GRADIENTS: Record<string, [string, string, string]> = {
  'scene-wwii': ['#4A5566', '#2B3140', '#171B22'],
  'scene-rome': ['#D7A85E', '#B5793B', '#7A4E27'],
  'scene-egypt': ['#E7C98B', '#C99A55', '#8C6431'],
  'scene-space': ['#0E1530', '#1B2550', '#0A0E1E'],
  'scene-dino': ['#5C7A5A', '#3B5940', '#22331F'],
};

type HubMode = 'globe' | 'panorama' | 'transitioning';

function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function hotspotToVector3(yaw: number, pitch: number, radius: number): THREE.Vector3 {
  const theta = (yaw / 100) * Math.PI * 2 - Math.PI;
  const phi = (pitch / 100) * Math.PI;
  return new THREE.Vector3(radius * Math.sin(phi) * Math.sin(theta), radius * Math.cos(phi), -radius * Math.sin(phi) * Math.cos(theta));
}

interface MarkerMesh extends THREE.Mesh {
  userData: { experience: Experience };
}

interface HotspotMesh extends THREE.Mesh {
  userData: { hotspot: Hotspot };
}

export interface PortalSceneCallbacks {
  onMarkerHover: (experience: Experience | null) => void;
  onHotspotHover: (hotspot: Hotspot | null) => void;
  onModeChange: (mode: 'globe' | 'panorama', experience: Experience | null) => void;
  onXRStateChange: (presenting: boolean) => void;
  /** Fired instead of opening the panorama when the content is locked. */
  onLockedSelect?: (experience: Experience) => void;
}

export class GlobeScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private globeGroup = new THREE.Group();
  private stars?: THREE.Points;
  private panoramaGroup = new THREE.Group();
  private panoramaCache = new Map<string, THREE.Group>();
  private overlayMesh!: THREE.Mesh;
  private overlayOpacityTarget = 0;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private markers: MarkerMesh[] = [];
  private activeHotspots: HotspotMesh[] = [];
  private hoveredMarker: MarkerMesh | null = null;
  private hoveredHotspot: HotspotMesh | null = null;
  private controllers: THREE.XRTargetRaySpace[] = [];
  private resizeObserver: ResizeObserver;
  private clock = new THREE.Clock();

  // Trigger-grab drag state (globe mode). One controller grabs at a time.
  private grabController: THREE.XRTargetRaySpace | null = null;
  private grabPrev = { yaw: 0, pitch: 0 };
  // A trigger press that started on a marker: opens it on release if the aim
  // didn't wander (otherwise it was a drag that happened to start on a marker).
  private pendingSelect: { controller: THREE.XRTargetRaySpace; marker: MarkerMesh; yaw: number; pitch: number } | null = null;

  // A single floating label reused for whichever marker/hotspot is aimed at.
  private hoverLabel!: THREE.Sprite;
  private labelTarget: THREE.Object3D | null = null;
  private labelHeight = LABEL_HEIGHT_GLOBE;

  private mode: HubMode = 'globe';

  // The panorama is the thing worth putting a headset on for, so outside XR the
  // globe stays fully explorable but the portals do not open. Never applies to
  // the in-XR dwell path -- if you are already in the headset, nothing to gate.
  private contentLocked = false;

  constructor(
    private container: HTMLElement,
    private experiences: Experience[],
    private callbacks: PortalSceneCallbacks,
  ) {
    const { clientWidth: width, clientHeight: height } = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.xr.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.camera.position.set(0, 0.4, 3.1);
    this.scene.add(this.camera);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.35;
    this.applyControlsForMode('globe');

    this.scene.add(this.globeGroup, this.panoramaGroup);
    this.panoramaGroup.visible = false;

    this.buildEarth();
    this.buildStars();
    this.buildMarkers(experiences);
    this.buildLights();
    this.buildFadeOverlay();
    this.buildHoverLabel();
    this.setupControllers();

    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('click', this.onClick);

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(container);

    this.renderer.setAnimationLoop(this.animate);
  }

  async isXRSupported(): Promise<boolean> {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) return false;
    try {
      return await xr.isSessionSupported('immersive-vr');
    } catch {
      return false;
    }
  }

  async enterXR(): Promise<void> {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) return;
    const session = await xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor'],
    });
    session.addEventListener('end', this.onXRSessionEnd);
    await this.renderer.xr.setSession(session);
    this.onXRSessionStart();
  }

  setContentLocked(locked: boolean): void {
    this.contentLocked = locked;
  }

  setActiveCategory(categorySlug: string | null): void {
    for (const marker of this.markers) {
      const match = !categorySlug || marker.userData.experience.categorySlug === categorySlug;
      const material = marker.material as THREE.MeshBasicMaterial;
      material.opacity = match ? 1 : 0.16;
      marker.scale.setScalar(match ? 1 : 0.7);
      const halo = marker.children[0] as THREE.Mesh;
      (halo.material as THREE.MeshBasicMaterial).opacity = match ? 0.35 : 0.05;
    }
  }

  /** Called from the "◐ Voltar ao Globo" control — same path the XR grip button uses. */
  returnToGlobe(): void {
    if (this.mode !== 'panorama') return;
    void this.transitionTo('globe', null);
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('click', this.onClick);
    this.renderer.xr.getSession()?.end();
    this.controls.dispose();
    // Points (starfield) and Line (controller rays) carry geometry and material
    // just like meshes do -- checking only for Mesh leaks both on every teardown.
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points || obj instanceof THREE.Line) {
        obj.geometry.dispose();
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const material of materials) {
          if (material instanceof THREE.MeshStandardMaterial) material.emissiveMap?.dispose();
          if ('map' in material) (material as THREE.MeshBasicMaterial).map?.dispose();
          material.dispose();
        }
      }
    });
    // The hover label is a Sprite, so the Mesh/Points/Line sweep above skips it.
    const labelMaterial = this.hoverLabel.material as THREE.SpriteMaterial;
    labelMaterial.map?.dispose();
    labelMaterial.dispose();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  // ---------------------------------------------------------------- globe

  private buildEarth(): void {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
    });
    const core = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS, 64, 64), material);
    this.globeGroup.add(core);

    const loader = new THREE.TextureLoader();

    // NASA Blue Marble (topography + bathymetry), public domain.
    loader.load('/textures/earth-color.jpg', (map) => {
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      material.map = map;
      material.needsUpdate = true;
    });

    loader.load('/textures/earth-mask.jpg', (source) => {
      material.roughnessMap = this.buildRoughnessMap(source.image as HTMLImageElement);
      material.needsUpdate = true;
    });

    const grid = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_RADIUS + 0.004, 24, 16),
      new THREE.MeshBasicMaterial({ color: COLOR_GRID, wireframe: true, transparent: true, opacity: 0.12 }),
    );
    this.globeGroup.add(grid);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_RADIUS + 0.05, 48, 48),
      new THREE.MeshBasicMaterial({ color: COLOR_ATMOSPHERE, transparent: true, opacity: 0.09, side: THREE.BackSide }),
    );
    this.globeGroup.add(atmosphere);
  }

  private buildRoughnessMap(image: HTMLImageElement): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext('2d')!;
    // earth-mask.jpg is a water mask (ocean white, land black). Inverted it doubles
    // as a roughness map: oceans glossy enough to catch the key light, land matte.
    ctx.filter = 'invert(1) grayscale(1)';
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    // Roughness is data, not colour — leave it in linear space.
    return new THREE.CanvasTexture(canvas);
  }

  private buildMarkers(experiences: Experience[]): void {
    const geometry = new THREE.SphereGeometry(0.02, 12, 12);
    const haloGeometry = new THREE.SphereGeometry(0.038, 12, 12);

    for (const experience of experiences) {
      const material = new THREE.MeshBasicMaterial({ color: COLOR_BRASS, transparent: true, opacity: 1 });
      const marker = new THREE.Mesh(geometry, material) as unknown as MarkerMesh;
      marker.userData = { experience };
      marker.position.copy(latLngToVector3(experience.lat, experience.lng, MARKER_RADIUS));

      const halo = new THREE.Mesh(haloGeometry, new THREE.MeshBasicMaterial({ color: COLOR_BRASS, transparent: true, opacity: 0.35 }));
      marker.add(halo);

      this.markers.push(marker);
      this.globeGroup.add(marker);
    }
  }

  private buildLights(): void {
    // Ambient stays high enough that markers on the night side remain readable —
    // this is a navigation hub, not a daylight simulation.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(2, 2, 3);
    this.scene.add(key);
  }

  /**
   * Starfield on a shell well outside the globe but inside the camera's far
   * plane. Sits at radius 40 -- the panorama sphere is radius 6 and opaque, so
   * entering an experience hides the stars without any extra bookkeeping.
   *
   * Points are placed by rejection sampling in a cube rather than by picking
   * lat/long directly, which would bunch them at the poles.
   */
  private buildStars(): void {
    const count = 1400;
    const positions = new Float32Array(count * 3);
    const v = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      do {
        v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      } while (v.lengthSq() > 1 || v.lengthSq() < 1e-4);
      v.normalize().multiplyScalar(40);
      positions.set([v.x, v.y, v.z], i * 3);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    this.stars = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0xede6d6,
        size: 0.13,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      }),
    );
    this.scene.add(this.stars);
  }

  // ------------------------------------------------------------ panorama

  private showPanorama(experience: Experience): void {
    // Each experience opens facing forward, clearing any thumbstick look-around
    // carried over from the last panorama.
    this.panoramaGroup.rotation.set(0, 0, 0);
    let group = this.panoramaCache.get(experience.slug);
    if (!group) {
      group = this.buildPanoramaGroup(experience);
      this.panoramaCache.set(experience.slug, group);
      this.panoramaGroup.add(group);
    }
    for (const [slug, cached] of this.panoramaCache) cached.visible = slug === experience.slug;
    this.activeHotspots = (group.userData['hotspots'] as HotspotMesh[]) ?? [];
  }

  private buildPanoramaGroup(experience: Experience): THREE.Group {
    const group = new THREE.Group();

    const sphereGeometry = new THREE.SphereGeometry(PANORAMA_RADIUS, 48, 32);
    sphereGeometry.scale(-1, 1, 1);
    const placeholder = this.generatePanoramaTexture(experience);
    const material = new THREE.MeshBasicMaterial({ map: placeholder });
    group.add(new THREE.Mesh(sphereGeometry, material));
    this.loadPanoramaPhoto(experience, material, placeholder);

    const hotspotMeshes: HotspotMesh[] = [];
    const markerGeometry = new THREE.SphereGeometry(0.06, 12, 12);
    const haloGeometry = new THREE.SphereGeometry(0.11, 12, 12);
    for (const hotspot of experience.hotspots) {
      const markerMaterial = new THREE.MeshBasicMaterial({ color: COLOR_BRASS });
      const marker = new THREE.Mesh(markerGeometry, markerMaterial) as unknown as HotspotMesh;
      marker.userData = { hotspot };
      marker.position.copy(hotspotToVector3(hotspot.yaw, hotspot.pitch, HOTSPOT_RADIUS));
      marker.add(new THREE.Mesh(haloGeometry, new THREE.MeshBasicMaterial({ color: COLOR_BRASS, transparent: true, opacity: 0.35 })));
      group.add(marker);
      hotspotMeshes.push(marker);
    }
    group.userData['hotspots'] = hotspotMeshes;

    return group;
  }

  // Real 8K equirect photo when the pipeline has generated one for this slug;
  // the procedural gradient stays up until it lands, and survives a 404.
  private loadPanoramaPhoto(
    experience: Experience,
    material: THREE.MeshBasicMaterial,
    placeholder: THREE.Texture,
  ): void {
    new THREE.TextureLoader().load(
      `/panoramas/${experience.slug}.jpg`,
      (photo) => {
        photo.colorSpace = THREE.SRGBColorSpace;
        photo.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        material.map = photo;
        material.needsUpdate = true;
        placeholder.dispose();
      },
      undefined,
      () => undefined,
    );
  }

  private generatePanoramaTexture(experience: Experience): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d')!;
    const [top, mid, bottom] = SCENE_GRADIENTS[experience.scene] ?? SCENE_GRADIENTS['scene-wwii'];

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, top);
    gradient.addColorStop(0.55, mid);
    gradient.addColorStop(1, bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(237,230,214,0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, canvas.height * 0.52);
    ctx.lineTo(canvas.width, canvas.height * 0.52);
    ctx.stroke();

    if (experience.scene === 'scene-space') {
      ctx.fillStyle = 'rgba(237,230,214,0.6)';
      for (let i = 0; i < 500; i++) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height * 0.5;
        ctx.beginPath();
        ctx.arc(x, y, Math.random() * 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  // ------------------------------------------------------------ transition

  private buildFadeOverlay(): void {
    const geometry = new THREE.SphereGeometry(0.2, 16, 16);
    const material = new THREE.MeshBasicMaterial({
      color: COLOR_INK,
      transparent: true,
      opacity: 0,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
    });
    this.overlayMesh = new THREE.Mesh(geometry, material);
    this.overlayMesh.renderOrder = 999;
    this.camera.add(this.overlayMesh);
  }

  private fadeTo(target: number): Promise<void> {
    this.overlayOpacityTarget = target;
    return new Promise((resolve) => setTimeout(resolve, FADE_MS));
  }

  private applyControlsForMode(mode: 'globe' | 'panorama'): void {
    if (mode === 'panorama') {
      this.camera.position.set(0, 0, 0.01);
      this.controls.minDistance = 0.01;
      this.controls.maxDistance = 0.4;
      this.controls.autoRotate = false;
    } else {
      this.camera.position.set(0, 0.4, 3.1);
      this.controls.minDistance = 1.8;
      this.controls.maxDistance = 5;
      this.controls.autoRotate = true;
    }
  }

  private async transitionTo(nextMode: 'globe' | 'panorama', experience: Experience | null): Promise<void> {
    if (this.mode === 'transitioning') return;
    this.mode = 'transitioning';
    this.setHoveredMarker(null);
    this.setHoveredHotspot(null);

    await this.fadeTo(1);

    if (nextMode === 'panorama' && experience) {
      this.globeGroup.visible = false;
      this.showPanorama(experience);
      this.panoramaGroup.visible = true;
    } else {
      this.panoramaGroup.visible = false;
      this.globeGroup.visible = true;
      this.activeHotspots = [];
    }
    this.applyControlsForMode(nextMode === 'panorama' ? 'panorama' : 'globe');
    this.controls.update();

    this.mode = nextMode;
    this.callbacks.onModeChange(nextMode, nextMode === 'panorama' ? experience : null);

    await this.fadeTo(0);
  }

  // ------------------------------------------------------------- controllers

  private setupControllers(): void {
    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i);

      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
      const ray = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: COLOR_BRASS, transparent: true, opacity: 0.7 }));
      ray.name = 'ray';
      ray.scale.z = 1.4;
      controller.add(ray);

      controller.addEventListener('selectstart', () => this.onXRSelectStart(controller));
      controller.addEventListener('selectend', () => this.onXRSelectEnd(controller));
      controller.addEventListener('squeezestart', () => this.returnToGlobe());

      this.scene.add(controller);
      this.controllers.push(controller);
    }
  }

  private controllerYawPitch(controller: THREE.XRTargetRaySpace): { yaw: number; pitch: number } {
    const dir = new THREE.Vector3(0, 0, -1).applyMatrix4(new THREE.Matrix4().extractRotation(controller.matrixWorld)).normalize();
    return { yaw: Math.atan2(dir.x, dir.z), pitch: Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)) };
  }

  private raycastMarker(controller: THREE.XRTargetRaySpace): MarkerMesh | null {
    const origin = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
    const direction = new THREE.Vector3(0, 0, -1).applyMatrix4(new THREE.Matrix4().extractRotation(controller.matrixWorld));
    this.raycaster.set(origin, direction);
    return (this.raycaster.intersectObjects(this.markers, false)[0]?.object as MarkerMesh) ?? null;
  }

  // Trigger down: on a marker it arms a select; on empty space it grabs the
  // globe so the coming controller sweep drags it. Only meaningful on the globe.
  private onXRSelectStart(controller: THREE.XRTargetRaySpace): void {
    if (this.mode !== 'globe') return;
    const marker = this.raycastMarker(controller);
    if (marker) {
      this.pendingSelect = { controller, marker, ...this.controllerYawPitch(controller) };
      return;
    }
    this.grabController = controller;
    this.grabPrev = this.controllerYawPitch(controller);
  }

  // Trigger up: release any grab; if the press began on a marker and the aim
  // barely moved, treat it as a click and open that experience.
  private onXRSelectEnd(controller: THREE.XRTargetRaySpace): void {
    if (this.grabController === controller) this.grabController = null;

    const pending = this.pendingSelect;
    if (!pending || pending.controller !== controller) return;
    this.pendingSelect = null;

    const { yaw, pitch } = this.controllerYawPitch(controller);
    const moved = Math.hypot(this.wrapAngle(yaw - pending.yaw), pitch - pending.pitch);
    if (moved < XR_SELECT_MOVE_TOLERANCE && this.raycastMarker(controller) === pending.marker) {
      void this.transitionTo('panorama', pending.marker.userData.experience);
    }
  }

  private wrapAngle(a: number): number {
    return Math.atan2(Math.sin(a), Math.cos(a));
  }

  private onXRSessionStart = (): void => {
    this.controls.enabled = false;
    this.globeGroup.position.copy(XR_GROUP_POSITION);
    this.callbacks.onXRStateChange(true);
  };

  private onXRSessionEnd = (): void => {
    this.controls.enabled = true;
    this.globeGroup.position.set(0, 0, 0);
    this.grabController = null;
    this.pendingSelect = null;
    this.callbacks.onXRStateChange(false);
  };

  /**
   * Aim both controllers in one pass and pick the single nearest hit to hover.
   * Doing this per-controller instead would let whichever controller points at
   * empty space clear the hover the other one just set, so the tooltip would
   * end every frame hidden and never render.
   */
  private updateControllers(): void {
    const pool: THREE.Object3D[] = this.mode === 'panorama' ? this.activeHotspots : this.markers;
    let best: THREE.Intersection | null = null;

    for (const controller of this.controllers) {
      const origin = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
      const direction = new THREE.Vector3(0, 0, -1).applyMatrix4(new THREE.Matrix4().extractRotation(controller.matrixWorld));
      this.raycaster.set(origin, direction);
      const hits = this.raycaster.intersectObjects(pool, false);

      const ray = controller.getObjectByName('ray') as THREE.Line | undefined;
      if (ray) ray.scale.z = hits[0]?.distance ?? 1.4;

      // The grabbing controller's ray sweeps across the globe during a drag;
      // don't let it re-target markers under it.
      if (this.mode !== 'panorama' && this.grabController === controller) continue;
      if (hits[0] && (!best || hits[0].distance < best.distance)) best = hits[0];
    }

    if (this.mode === 'panorama') this.setHoveredHotspot((best?.object as HotspotMesh) ?? null);
    else this.setHoveredMarker((best?.object as MarkerMesh) ?? null);
  }

  // ------------------------------------------------------------- tooltip

  /**
   * A single billboarded label reused for whichever marker or hotspot is being
   * aimed at. It lives in world space so it shows in both the desktop preview
   * and — crucially — inside the headset, where the DOM HUD isn't visible.
   */
  private buildHoverLabel(): void {
    const material = new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false });
    this.hoverLabel = new THREE.Sprite(material);
    this.hoverLabel.visible = false;
    this.hoverLabel.renderOrder = 998;
    this.scene.add(this.hoverLabel);
  }

  private setLabel(target: THREE.Object3D | null, title = '', subtitle = '', worldHeight = LABEL_HEIGHT_GLOBE): void {
    this.labelTarget = target;
    if (!target) {
      this.hoverLabel.visible = false;
      return;
    }
    const { texture, aspect } = this.makeLabelTexture(title, subtitle);
    const material = this.hoverLabel.material as THREE.SpriteMaterial;
    material.map?.dispose();
    material.map = texture;
    material.needsUpdate = true;
    this.labelHeight = worldHeight;
    this.hoverLabel.scale.set(worldHeight * aspect, worldHeight, 1);
    this.hoverLabel.visible = true;
    this.updateLabelPosition();
  }

  private updateLabelPosition(): void {
    if (!this.labelTarget || !this.hoverLabel.visible) return;
    const p = this.labelTarget.getWorldPosition(new THREE.Vector3());
    p.y += this.labelHeight * 0.85; // lift clear of the marker/hotspot dot
    this.hoverLabel.position.copy(p);
  }

  private makeLabelTexture(title: string, subtitle: string): { texture: THREE.CanvasTexture; aspect: number } {
    const width = 640;
    const height = subtitle ? 200 : 132;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    const pad = 28;
    const radius = 28;
    ctx.fillStyle = 'rgba(24,28,37,0.92)';
    ctx.strokeStyle = 'rgba(217,168,87,0.85)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(pad / 2, pad / 2, width - pad, height - pad, radius);
    ctx.fill();
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f4ecd8';
    ctx.font = '600 46px "IBM Plex Sans", system-ui, sans-serif';
    this.fillClipped(ctx, title, pad, subtitle ? height * 0.36 : height / 2, width - pad * 2);

    if (subtitle) {
      ctx.fillStyle = 'rgba(217,168,87,0.95)';
      ctx.font = '400 32px "IBM Plex Sans", system-ui, sans-serif';
      this.fillClipped(ctx, subtitle, pad, height * 0.66, width - pad * 2);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return { texture, aspect: width / height };
  }

  private fillClipped(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number): void {
    let str = text;
    if (ctx.measureText(str).width <= maxWidth) {
      ctx.fillText(str, x, y);
      return;
    }
    while (str.length > 1 && ctx.measureText(str + '…').width > maxWidth) str = str.slice(0, -1);
    ctx.fillText(str + '…', x, y);
  }

  /**
   * In immersive VR the OrbitControls are disabled (the headset owns the
   * camera), so navigation is driven from the controllers.
   *
   * Globe: hold the trigger and sweep the controller to grab and drag the globe
   * (the primary, most natural gesture); the thumbstick stays as a comfort
   * option — horizontal spins, vertical zooms via the group scale. With no input
   * it keeps a slow auto-rotate so far-side markers come around on their own.
   *
   * Panorama: the thumbstick's horizontal axis spins the 360 image around you so
   * you can look left/right without physically turning your body.
   *
   * Quest maps the thumbstick to axes[2]/axes[3]; axes[0]/axes[1] is the
   * fallback for controllers that expose the stick there.
   */
  private updateXRNavigation(delta: number): void {
    const session = this.renderer.xr.getSession();
    if (!session) return;

    if (this.mode === 'panorama') {
      let look = 0;
      for (const source of session.inputSources) {
        const x = source.gamepad?.axes?.[2] ?? source.gamepad?.axes?.[0] ?? 0;
        if (Math.abs(x) > XR_STICK_DEADZONE) look += x;
      }
      // Stick left (negative) should turn your view left, which means spinning
      // the surrounding image the same signed direction.
      if (Math.abs(look) > 0.01) this.panoramaGroup.rotation.y += look * XR_PANO_LOOK_SPEED * delta;
      return;
    }

    if (this.mode !== 'globe') return;

    // Trigger-grab: the grabbing controller's sweep since last frame drags the
    // globe. Yaw follows the hand; pitch tilts it, clamped short of the poles.
    let grabbing = false;
    if (this.grabController) {
      grabbing = true;
      const { yaw, pitch } = this.controllerYawPitch(this.grabController);
      const dYaw = this.wrapAngle(yaw - this.grabPrev.yaw);
      const dPitch = pitch - this.grabPrev.pitch;
      this.grabPrev = { yaw, pitch };
      this.globeGroup.rotation.y += dYaw * XR_GRAB_ROTATE_GAIN;
      this.globeGroup.rotation.x = THREE.MathUtils.clamp(
        this.globeGroup.rotation.x - dPitch * XR_GRAB_ROTATE_GAIN,
        XR_GRAB_PITCH_MIN,
        XR_GRAB_PITCH_MAX,
      );
    }

    let rotateInput = 0;
    let zoomInput = 0;
    for (const source of session.inputSources) {
      const axes = source.gamepad?.axes;
      if (!axes) continue;
      const x = axes[2] ?? axes[0] ?? 0;
      const y = axes[3] ?? axes[1] ?? 0;
      if (Math.abs(x) > XR_STICK_DEADZONE) rotateInput += x;
      if (Math.abs(y) > XR_STICK_DEADZONE) zoomInput += y;
    }

    const manualRotate = Math.abs(rotateInput) > 0.01;
    if (manualRotate) this.globeGroup.rotation.y += -rotateInput * XR_ROTATE_SPEED * delta;
    else if (!grabbing) this.globeGroup.rotation.y += XR_AUTOROTATE_SPEED * delta;

    if (Math.abs(zoomInput) > 0.01) {
      // Stick forward reads negative -> zoom in (scale up).
      const next = this.globeGroup.scale.x * (1 - zoomInput * XR_ZOOM_SPEED * delta);
      this.globeGroup.scale.setScalar(THREE.MathUtils.clamp(next, XR_ZOOM_MIN, XR_ZOOM_MAX));
    }
  }

  private setHoveredMarker(target: MarkerMesh | null): void {
    if (target === this.hoveredMarker) return;
    if (this.hoveredMarker) this.hoveredMarker.scale.setScalar(1);
    this.hoveredMarker = target;
    if (this.hoveredMarker) this.hoveredMarker.scale.setScalar(1.6);
    if (target) {
      const e = target.userData.experience;
      this.setLabel(target, e.title, `${this.formatYear(e.year)} · ${e.location}`, LABEL_HEIGHT_GLOBE);
    } else {
      this.setLabel(null);
    }
    this.callbacks.onMarkerHover(target?.userData.experience ?? null);
  }

  private setHoveredHotspot(target: HotspotMesh | null): void {
    if (target === this.hoveredHotspot) return;
    if (this.hoveredHotspot) this.hoveredHotspot.scale.setScalar(1);
    this.hoveredHotspot = target;
    if (this.hoveredHotspot) this.hoveredHotspot.scale.setScalar(1.4);
    if (target) {
      const h = target.userData.hotspot;
      this.setLabel(target, h.title, h.description, LABEL_HEIGHT_PANORAMA);
    } else {
      this.setLabel(null);
    }
    this.callbacks.onHotspotHover(target?.userData.hotspot ?? null);
  }

  private formatYear(year: number): string {
    if (year < 0) {
      const magnitude = Math.abs(year);
      return magnitude >= 100000 ? `${(magnitude / 1_000_000).toLocaleString('pt-BR')} milhões de anos atrás` : `${magnitude} a.C.`;
    }
    return `${year}`;
  }

  // ------------------------------------------------------------------ mouse

  private onPointerMove = (event: PointerEvent): void => {
    if (this.renderer.xr.isPresenting || this.mode === 'transitioning') return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);

    if (this.mode === 'panorama') {
      const hits = this.raycaster.intersectObjects(this.activeHotspots, false);
      this.setHoveredHotspot((hits[0]?.object as HotspotMesh) ?? null);
      this.renderer.domElement.style.cursor = hits[0] ? 'pointer' : 'grab';
      return;
    }

    const hits = this.raycaster.intersectObjects(this.markers, false);
    const next = (hits[0]?.object as MarkerMesh) ?? null;
    if (next !== this.hoveredMarker) {
      this.setHoveredMarker(next);
      this.controls.autoRotate = !next;
    }
    this.renderer.domElement.style.cursor = next ? 'pointer' : 'grab';
  };

  private onClick = (): void => {
    if (this.renderer.xr.isPresenting || this.mode !== 'globe') return;
    if (!this.hoveredMarker) return;
    const experience = this.hoveredMarker.userData.experience;
    if (this.contentLocked) {
      this.callbacks.onLockedSelect?.(experience);
      return;
    }
    void this.transitionTo('panorama', experience);
  };

  private onResize(): void {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private animate = (): void => {
    const overlayMaterial = this.overlayMesh.material as THREE.MeshBasicMaterial;
    overlayMaterial.opacity += (this.overlayOpacityTarget - overlayMaterial.opacity) * 0.18;

    if (this.renderer.xr.isPresenting) {
      const delta = Math.min(this.clock.getDelta(), 0.05);
      this.updateXRNavigation(delta);
      this.updateControllers();
    } else if (this.mode !== 'transitioning') {
      this.controls.update();
    }
    this.updateLabelPosition();
    this.renderer.render(this.scene, this.camera);
  };
}
