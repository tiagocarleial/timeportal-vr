import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Experience, Hotspot } from '../../core/models/experience.model';

const EARTH_RADIUS = 1.2;
const MARKER_RADIUS = EARTH_RADIUS + 0.012;
const PANORAMA_RADIUS = 6;
const HOTSPOT_RADIUS = PANORAMA_RADIUS - 0.5;
const XR_GROUP_POSITION = new THREE.Vector3(0, 1.3, -1.6);
const SELECT_DWELL_MS = 350;
const FADE_MS = 380;

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
      controller.userData['dwellStart'] = null;
      controller.userData['dwellTarget'] = null;

      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
      const ray = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: COLOR_BRASS, transparent: true, opacity: 0.7 }));
      ray.name = 'ray';
      ray.scale.z = 1.4;
      controller.add(ray);

      controller.addEventListener('selectstart', () => {
        controller.userData['dwellStart'] = performance.now();
      });
      controller.addEventListener('selectend', () => {
        controller.userData['dwellStart'] = null;
        controller.userData['dwellTarget'] = null;
      });
      controller.addEventListener('squeezestart', () => this.returnToGlobe());

      this.scene.add(controller);
      this.controllers.push(controller);
    }
  }

  private onXRSessionStart = (): void => {
    this.controls.enabled = false;
    this.globeGroup.position.copy(XR_GROUP_POSITION);
    this.callbacks.onXRStateChange(true);
  };

  private onXRSessionEnd = (): void => {
    this.controls.enabled = true;
    this.globeGroup.position.set(0, 0, 0);
    this.callbacks.onXRStateChange(false);
  };

  private updateControllerRay(controller: THREE.XRTargetRaySpace): void {
    const origin = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
    const direction = new THREE.Vector3(0, 0, -1).applyMatrix4(new THREE.Matrix4().extractRotation(controller.matrixWorld));
    this.raycaster.set(origin, direction);

    const pool: THREE.Object3D[] = this.mode === 'panorama' ? this.activeHotspots : this.markers;
    const hits = this.raycaster.intersectObjects(pool, false);
    const ray = controller.getObjectByName('ray') as THREE.Line | undefined;
    if (ray) ray.scale.z = hits[0]?.distance ?? 1.4;

    if (this.mode === 'panorama') {
      this.setHoveredHotspot((hits[0]?.object as HotspotMesh) ?? null);
      return;
    }

    const target = (hits[0]?.object as MarkerMesh) ?? null;
    const dwellTarget = controller.userData['dwellTarget'] as MarkerMesh | null;
    let dwellStart = controller.userData['dwellStart'] as number | null;

    if (target !== dwellTarget) {
      controller.userData['dwellTarget'] = target;
      dwellStart = dwellStart !== null ? performance.now() : null;
      controller.userData['dwellStart'] = dwellStart;
      this.setHoveredMarker(target);
    }

    if (target && dwellStart !== null) {
      if (performance.now() - dwellStart >= SELECT_DWELL_MS) {
        controller.userData['dwellStart'] = null;
        void this.transitionTo('panorama', target.userData.experience);
      }
    }
  }

  private setHoveredMarker(target: MarkerMesh | null): void {
    if (target === this.hoveredMarker) return;
    if (this.hoveredMarker) this.hoveredMarker.scale.setScalar(1);
    this.hoveredMarker = target;
    if (this.hoveredMarker) this.hoveredMarker.scale.setScalar(1.6);
    this.callbacks.onMarkerHover(target?.userData.experience ?? null);
  }

  private setHoveredHotspot(target: HotspotMesh | null): void {
    if (target === this.hoveredHotspot) return;
    if (this.hoveredHotspot) this.hoveredHotspot.scale.setScalar(1);
    this.hoveredHotspot = target;
    if (this.hoveredHotspot) this.hoveredHotspot.scale.setScalar(1.4);
    this.callbacks.onHotspotHover(target?.userData.hotspot ?? null);
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
      for (const controller of this.controllers) this.updateControllerRay(controller);
    } else if (this.mode !== 'transitioning') {
      this.controls.update();
    }
    this.renderer.render(this.scene, this.camera);
  };
}
