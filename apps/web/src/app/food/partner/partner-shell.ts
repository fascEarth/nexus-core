import { Component, inject, Injectable, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { EventHub } from '../../core/event-hub.service';
import { FoodApi, Restaurant } from '../food.api';

/** Which restaurant the console shows (partners: their own; admins may switch). */
@Injectable({ providedIn: 'root' })
export class PartnerContext {
  readonly restaurantId = signal<string | undefined>(undefined);
  readonly restaurant = signal<Restaurant | null>(null);
  readonly restaurants = signal<{ id: string; name: string }[]>([]);
}

@Component({
  selector: 'fx-partner-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule],
  template: `
    <div class="fx fx-console">
      <header class="fx-top">
        <div class="fx-wrap">
          <a class="fx-logo" routerLink="/partner"><i>🍽</i><span>NexEats <small class="fx-muted" style="font-weight:500">Partner</small></span></a>
          @if (ctx.restaurant(); as r) {
            @if (ctx.restaurants().length) {
              <select style="width:auto;background:#1f2937;color:#fff;border-color:#374151" [ngModel]="r.id" (ngModelChange)="ctx.restaurantId.set($event)">
                @for (x of ctx.restaurants(); track x.id) { <option [value]="x.id">{{ x.name }}</option> }
              </select>
            } @else { <b>{{ r.emoji }} {{ r.name }}</b> }
            <button class="fx-toggle" [class.on]="r.isOpen" (click)="toggleOpen(r)" [disabled]="busy()"><i></i>{{ r.isOpen ? 'Accepting orders' : 'Closed' }}</button>
          }
          <span class="grow"></span>
          <nav class="fx-toplinks">
            <a routerLink="/partner" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Orders</a>
            <a routerLink="/partner/menu" routerLinkActive="active">Menu</a>
            <a routerLink="/partner/insights" routerLinkActive="active">Insights</a>
          </nav>
          <span class="dot" [class.on]="hub.connected()" [title]="hub.connected() ? 'Live' : 'Offline'"></span>
          <button class="fx-btn sm ghost" style="color:#fff;border-color:rgb(255 255 255 / 35%)" (click)="auth.logout()">Sign out</button>
        </div>
      </header>
      <router-outlet />
    </div>
  `,
})
export class PartnerShell implements OnInit {
  auth = inject(AuthService);
  hub = inject(EventHub);
  ctx = inject(PartnerContext);
  private api = inject(FoodApi);
  busy = signal(false);

  ngOnInit() {
    this.hub.connect();
  }

  async toggleOpen(r: Restaurant) {
    this.busy.set(true);
    try {
      await this.api.patchRestaurant(r.id, { isOpen: !r.isOpen });
      this.ctx.restaurant.set({ ...r, isOpen: !r.isOpen });
    } finally {
      this.busy.set(false);
    }
  }
}
