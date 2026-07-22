import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Category } from '../../../core/models/category.model';

@Component({
  selector: 'app-category-card',
  imports: [RouterLink],
  templateUrl: './category-card.html',
  styleUrl: './category-card.css',
})
export class CategoryCard {
  category = input.required<Category>();
}
