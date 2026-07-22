export interface Hotspot {
  yaw: number;
  pitch: number;
  title: string;
  description: string;
}

export interface Experience {
  id: string;
  slug: string;
  title: string;
  categorySlug: string;
  date: string;
  year: number;
  location: string;
  coordinates: string;
  lat: number;
  lng: number;
  description: string;
  resolution: string;
  scene: string;
  hotspots: Hotspot[];
}
