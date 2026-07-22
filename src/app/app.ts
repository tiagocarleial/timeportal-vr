import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { Navbar } from './shared/components/navbar/navbar';
import { Footer } from './shared/components/footer/footer';

/** Routes that own the whole viewport and render no navbar/footer around them. */
const IMMERSIVE_ROUTES = ['/'];

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Navbar, Footer],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private router = inject(Router);

  immersive = signal(IMMERSIVE_ROUTES.includes(this.router.url.split('?')[0]));

  constructor() {
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        this.immersive.set(IMMERSIVE_ROUTES.includes(event.urlAfterRedirects.split('?')[0]));
      });
  }
}
