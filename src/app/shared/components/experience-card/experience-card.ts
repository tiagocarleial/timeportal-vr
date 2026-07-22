import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Experience } from '../../../core/models/experience.model';

@Component({
  selector: 'app-experience-card',
  imports: [RouterLink],
  templateUrl: './experience-card.html',
  styleUrl: './experience-card.css',
})
export class ExperienceCard {
  experience = input.required<Experience>();
}
