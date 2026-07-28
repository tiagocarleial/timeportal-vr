import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import { Catalog } from '../../core/services/catalog';
import { Experience } from '../../core/models/experience.model';
import { GlobeScene } from '../globe/globe-scene';

/**
 * The landing experience: a black room with the Earth in it, and nothing else.
 *
 * Deliberately not a page -- no navbar, no cards, no sections. Every piece of
 * text here is a single line that reacts to what the scene is doing, so the
 * globe never competes with chrome for attention.
 */
@Component({
  selector: 'app-portal',
  imports: [],
  templateUrl: './portal.html',
  styleUrl: './portal.css',
})
export class Portal implements AfterViewInit, OnDestroy {
  @ViewChild('canvasHost', { static: true }) private canvasHost!: ElementRef<HTMLElement>;

  private catalog = inject(Catalog);
  private scene?: GlobeScene;

  hoveredMarker = signal<Experience | null>(null);
  xrSupported = signal<boolean | null>(null);
  xrPresenting = signal(false);
  xrError = signal<string | null>(null);

  ngAfterViewInit(): void {
    // Content is open everywhere: most visitors arrive on desktop without a
    // headset, so gating the panoramas behind VR would leave them nothing to
    // see (and nothing to share). The VR entry below stays as the richer path.
    this.scene = new GlobeScene(this.canvasHost.nativeElement, this.catalog.getExperiences(), {
      onMarkerHover: (experience) => this.hoveredMarker.set(experience),
      onHotspotHover: () => undefined,
      onModeChange: () => undefined,
      onXRStateChange: (presenting) => this.xrPresenting.set(presenting),
    });

    this.scene.isXRSupported().then((supported) => this.xrSupported.set(supported));
  }

  ngOnDestroy(): void {
    this.scene?.dispose();
  }

  async enterVR(): Promise<void> {
    this.xrError.set(null);
    try {
      await this.scene?.enterXR();
    } catch {
      this.xrError.set('Não foi possível iniciar a sessão. Confira se o headset está conectado.');
    }
  }
}
