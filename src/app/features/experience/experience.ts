import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Catalog } from '../../core/services/catalog';

@Component({
  selector: 'app-experience',
  imports: [RouterLink],
  templateUrl: './experience.html',
  styleUrl: './experience.css',
})
export class ExperiencePage {
  private catalog = inject(Catalog);

  slug = input.required<string>();

  experience = computed(() => this.catalog.getExperience(this.slug()));
  category = computed(() => {
    const exp = this.experience();
    return exp ? this.catalog.getCategory(exp.categorySlug) : undefined;
  });
  related = computed(() => {
    const exp = this.experience();
    return exp ? this.catalog.getExperiences(exp.categorySlug) : [];
  });
}
