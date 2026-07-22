import { Component, inject } from '@angular/core';
import { Timeline } from '../../shared/components/timeline/timeline';
import { CategoryCard } from '../../shared/components/category-card/category-card';
import { Catalog } from '../../core/services/catalog';

@Component({
  selector: 'app-home',
  imports: [Timeline, CategoryCard],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  private catalog = inject(Catalog);
  categories = this.catalog.getCategories();
}
