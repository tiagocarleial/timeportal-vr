import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ExperienceCard } from '../../shared/components/experience-card/experience-card';
import { Catalog } from '../../core/services/catalog';

@Component({
  selector: 'app-category',
  imports: [ExperienceCard, RouterLink],
  templateUrl: './category.html',
  styleUrl: './category.css',
})
export class CategoryPage {
  private catalog = inject(Catalog);

  slug = input.required<string>();

  category = computed(() => this.catalog.getCategory(this.slug()));
  experiences = computed(() => this.catalog.getExperiences(this.slug()));
}
