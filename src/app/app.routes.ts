import { Routes } from '@angular/router';
import { Home } from './features/home/home';
import { CategoryPage } from './features/category/category';
import { ExperiencePage } from './features/experience/experience';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./features/portal/portal').then((m) => m.Portal) },
  // Kept reachable but unlinked while the immersive entry settles.
  { path: 'inicio', component: Home },
  { path: 'explore', loadComponent: () => import('./features/globe/globe').then((m) => m.Globe) },
  { path: 'category/:slug', component: CategoryPage },
  { path: 'experience/:slug', component: ExperiencePage },
  { path: '**', redirectTo: '' },
];
