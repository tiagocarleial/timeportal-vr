import { Injectable } from '@angular/core';
import { Category } from '../models/category.model';
import { Experience } from '../models/experience.model';

const CATEGORIES: Category[] = [
  {
    slug: 'wwii',
    name: 'World War II',
    eyebrow: 'Segunda Guerra',
    period: '1939–1945',
    scene: 'scene-wwii',
    description:
      'De Pearl Harbor à queda de Berlim — os cenários mais decisivos do conflito reconstruídos em panoramas de 8K.',
  },
  {
    slug: 'ancient-rome',
    name: 'Ancient Rome',
    eyebrow: 'Mundo Antigo',
    period: '80 CE',
    scene: 'scene-rome',
    description: 'Coliseu lotado, fórum romano, Pompeia antes da erupção.',
  },
  {
    slug: 'ancient-egypt',
    name: 'Ancient Egypt',
    eyebrow: 'Mundo Antigo',
    period: '2560 BCE',
    scene: 'scene-egypt',
    description: 'A construção das pirâmides de Gizé.',
  },
  {
    slug: 'space',
    name: 'Apollo 11',
    eyebrow: 'Espaço',
    period: '1969',
    scene: 'scene-space',
    description: 'Superfície lunar, o nascer da Terra, a missão que definiu uma era.',
  },
  {
    slug: 'jurassic',
    name: 'Jurassic World',
    eyebrow: 'Pré-histórico',
    period: '65 MYA',
    scene: 'scene-dino',
    description: 'Floresta jurássica, T-Rex, pterossauros, o fundo do oceano pré-histórico.',
  },
];

const EXPERIENCES: Experience[] = [
  {
    id: 'd-day-omaha-beach',
    slug: 'd-day-omaha-beach',
    title: 'D-Day — Omaha Beach',
    categorySlug: 'wwii',
    date: '6 de junho de 1944',
    year: 1944,
    location: 'Normandia, França',
    coordinates: '49.3728° N, 0.5822° W',
    lat: 49.3728,
    lng: -0.5822,
    resolution: '8192×4096',
    scene: 'scene-wwii',
    description:
      'Reconstrução do desembarque americano em Omaha Beach, vista de dentro de uma barcaça Higgins sob fogo de artilharia costeira. Centenas de embarcações cruzam o Canal da Mancha sob céu nublado.',
    hotspots: [
      { yaw: 34, pitch: 58, title: 'Sherman M4 Tank', description: 'Tanque de apoio à infantaria na praia.' },
      { yaw: 64, pitch: 70, title: 'Beach Obstacles', description: "Obstáculos anti-desembarque conhecidos como 'Belgian Gates'." },
    ],
  },
  {
    id: 'd-day-beachhead',
    slug: 'd-day-beachhead',
    title: 'D-Day — Cabeça de Praia',
    categorySlug: 'wwii',
    date: '6 de junho de 1944',
    year: 1944,
    location: 'Normandia, França',
    coordinates: '49.3958° N, 0.7000° W',
    lat: 49.3958,
    lng: -0.7,
    resolution: '4096×2048',
    scene: 'scene-wwii',
    description:
      'De dentro de uma trincheira aliada acima da praia: o tanque Sherman avança, a armada de invasão cobre o Canal ao fundo, caças e bombardeiros cruzam o céu nublado e balões de barragem protegem a cabeça de praia recém-conquistada.',
    hotspots: [
      { yaw: 50, pitch: 56, title: 'Tanque Sherman', description: 'Blindado M4 abrindo caminho a partir da trincheira.' },
      { yaw: 61, pitch: 47, title: 'Armada Aliada', description: 'Centenas de navios e barcaças cruzando o Canal da Mancha.' },
      { yaw: 40, pitch: 51, title: 'Bunker Alemão', description: 'Casamata de concreto da Muralha do Atlântico sobre a praia.' },
    ],
  },
  {
    id: 'stalingrad',
    slug: 'stalingrad',
    title: 'Stalingrad',
    categorySlug: 'wwii',
    date: 'Novembro de 1942',
    year: 1942,
    location: 'Stalingrado, URSS',
    coordinates: '48.7080° N, 44.5133° E',
    lat: 48.708,
    lng: 44.5133,
    resolution: '8192×4096',
    scene: 'scene-wwii',
    description: 'Combate urbano nas ruínas da fábrica Barrikady, no auge da batalha mais sangrenta da guerra.',
    hotspots: [],
  },
  {
    id: 'battle-of-the-bulge',
    slug: 'battle-of-the-bulge',
    title: 'Battle of the Bulge',
    categorySlug: 'wwii',
    date: 'Dezembro de 1944',
    year: 1944,
    location: 'Ardenas, Bélgica',
    coordinates: '50.2333° N, 5.9333° E',
    lat: 50.2333,
    lng: 5.9333,
    resolution: '6144×3072',
    scene: 'scene-wwii',
    description: 'A floresta das Ardenas sob neve intensa, durante a última grande ofensiva alemã no oeste.',
    hotspots: [],
  },
  {
    id: 'fall-of-berlin',
    slug: 'fall-of-berlin',
    title: 'Fall of Berlin',
    categorySlug: 'wwii',
    date: 'Abril de 1945',
    year: 1945,
    location: 'Berlim, Alemanha',
    coordinates: '52.5186° N, 13.3762° E',
    lat: 52.5186,
    lng: 13.3762,
    resolution: '8192×4096',
    scene: 'scene-wwii',
    description: 'Em frente ao Reichstag, nos últimos dias do Terceiro Reich.',
    hotspots: [],
  },
  {
    id: 'colosseum-80ce',
    slug: 'colosseum-80ce',
    title: 'The Colosseum, 80 CE',
    categorySlug: 'ancient-rome',
    date: 'Inauguração, 80 d.C.',
    year: 80,
    location: 'Roma, Itália',
    coordinates: '41.8902° N, 12.4922° E',
    lat: 41.8902,
    lng: 12.4922,
    resolution: '8192×4096',
    scene: 'scene-rome',
    description: 'A arena lotada no dia da inauguração, sob o comando do imperador Tito.',
    hotspots: [],
  },
  {
    id: 'pompeii-79ce',
    slug: 'pompeii-79ce',
    title: 'Pompeii, 79 CE',
    categorySlug: 'ancient-rome',
    date: '24 de agosto de 79 d.C.',
    year: 79,
    location: 'Pompeia, Itália',
    coordinates: '40.7461° N, 14.4989° E',
    lat: 40.7461,
    lng: 14.4989,
    resolution: '8192×4096',
    scene: 'scene-rome',
    description: 'O fórum de Pompeia horas antes da erupção do Vesúvio.',
    hotspots: [],
  },
  {
    id: 'giza-pyramids-2560bce',
    slug: 'giza-pyramids-2560bce',
    title: 'Giza Pyramids, 2560 BCE',
    categorySlug: 'ancient-egypt',
    date: 'c. 2560 a.C.',
    year: -2560,
    location: 'Gizé, Egito',
    coordinates: '29.9792° N, 31.1342° E',
    lat: 29.9792,
    lng: 31.1342,
    resolution: '8192×4096',
    scene: 'scene-egypt',
    description: 'A Grande Pirâmide em construção, com rampas e milhares de trabalhadores.',
    hotspots: [],
  },
  {
    id: 'apollo11-tranquility-base',
    slug: 'apollo11-tranquility-base',
    title: 'Tranquility Base',
    categorySlug: 'space',
    date: '20 de julho de 1969',
    year: 1969,
    location: 'Mar da Tranquilidade, Lua',
    coordinates: '0.6741° N, 23.4730° E',
    lat: 0.6741,
    lng: 23.473,
    resolution: '8192×4096',
    scene: 'scene-space',
    description: 'O local do primeiro pouso tripulado na Lua, módulo lunar Eagle ao fundo.',
    hotspots: [],
  },
  {
    id: 'jurassic-forest',
    slug: 'jurassic-forest',
    title: 'Jurassic Forest',
    categorySlug: 'jurassic',
    date: 'c. 150 milhões a.C.',
    year: -150000000,
    location: 'Laurásia (América do Norte atual)',
    coordinates: '41.0000° N, 105.0000° W',
    lat: 41,
    lng: -105,
    resolution: '6144×3072',
    scene: 'scene-dino',
    description: 'Floresta de coníferas e samambaias densa, território de saurópodes e pterossauros.',
    hotspots: [],
  },
];

@Injectable({ providedIn: 'root' })
export class Catalog {
  getCategories(): Category[] {
    return CATEGORIES;
  }

  getCategory(slug: string): Category | undefined {
    return CATEGORIES.find((c) => c.slug === slug);
  }

  getExperiences(categorySlug?: string): Experience[] {
    return categorySlug ? EXPERIENCES.filter((e) => e.categorySlug === categorySlug) : EXPERIENCES;
  }

  getExperience(slug: string): Experience | undefined {
    return EXPERIENCES.find((e) => e.slug === slug);
  }
}
