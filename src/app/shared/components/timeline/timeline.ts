import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

export interface TimelineTick {
  year: string;
  era: string;
  link: string[];
  active?: boolean;
}

const DEFAULT_TICKS: TimelineTick[] = [
  { year: '65 MYA', era: 'Jurássico', link: ['/category', 'jurassic'] },
  { year: '2560 BCE', era: 'Egito Antigo', link: ['/category', 'ancient-egypt'] },
  { year: '80 CE', era: 'Roma', link: ['/category', 'ancient-rome'] },
  { year: '1944', era: 'Normandia', link: ['/category', 'wwii'], active: true },
  { year: '1945', era: 'Berlim', link: ['/category', 'wwii'] },
  { year: '1969', era: 'Apollo 11', link: ['/category', 'space'] },
];

@Component({
  selector: 'app-timeline',
  imports: [RouterLink],
  templateUrl: './timeline.html',
  styleUrl: './timeline.css',
})
export class Timeline {
  ticks = input<TimelineTick[]>(DEFAULT_TICKS);
}
