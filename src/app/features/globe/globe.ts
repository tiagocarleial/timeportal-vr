import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import { Catalog } from '../../core/services/catalog';
import { Experience, Hotspot } from '../../core/models/experience.model';
import { GlobeScene } from './globe-scene';

interface EraFilter {
  label: string;
  categorySlug: string | null;
}

const ERA_FILTERS: EraFilter[] = [
  { label: 'Todas as eras', categorySlug: null },
  { label: 'Pré-histórico', categorySlug: 'jurassic' },
  { label: 'Egito Antigo', categorySlug: 'ancient-egypt' },
  { label: 'Roma', categorySlug: 'ancient-rome' },
  { label: 'Segunda Guerra', categorySlug: 'wwii' },
  { label: 'Espaço', categorySlug: 'space' },
];

@Component({
  selector: 'app-globe',
  imports: [],
  templateUrl: './globe.html',
  styleUrl: './globe.css',
})
export class Globe implements AfterViewInit, OnDestroy {
  @ViewChild('canvasHost', { static: true }) private canvasHost!: ElementRef<HTMLElement>;

  private catalog = inject(Catalog);
  private scene?: GlobeScene;

  eras = ERA_FILTERS;
  activeEra = signal<EraFilter>(ERA_FILTERS[0]);
  hoveredMarker = signal<Experience | null>(null);
  hoveredHotspot = signal<Hotspot | null>(null);
  mode = signal<'globe' | 'panorama'>('globe');
  panoramaExperience = signal<Experience | null>(null);
  xrSupported = signal<boolean | null>(null);
  xrPresenting = signal(false);
  xrError = signal<string | null>(null);

  ngAfterViewInit(): void {
    this.scene = new GlobeScene(this.canvasHost.nativeElement, this.catalog.getExperiences(), {
      onMarkerHover: (experience) => this.hoveredMarker.set(experience),
      onHotspotHover: (hotspot) => this.hoveredHotspot.set(hotspot),
      onModeChange: (mode, experience) => {
        this.mode.set(mode);
        this.panoramaExperience.set(experience);
      },
      onXRStateChange: (presenting) => this.xrPresenting.set(presenting),
    });
    this.scene.isXRSupported().then((supported) => this.xrSupported.set(supported));
  }

  ngOnDestroy(): void {
    this.scene?.dispose();
  }

  selectEra(era: EraFilter): void {
    this.activeEra.set(era);
    this.scene?.setActiveCategory(era.categorySlug);
  }

  returnToGlobe(): void {
    this.scene?.returnToGlobe();
  }

  async enterVR(): Promise<void> {
    this.xrError.set(null);
    try {
      await this.scene?.enterXR();
    } catch {
      this.xrError.set('Não foi possível iniciar a sessão VR. Confira se o headset está conectado.');
    }
  }
}
