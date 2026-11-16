import { Component, inject, Injectable, OnInit, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { EventHub } from '../../core/event-hub.service';
import { FoodApi, RiderHome } from '../food.api';

@Injectable({ providedIn: 'root' })
export class RiderState {
  private api = inject(FoodApi);
  readonly home = signal<RiderHome | null>(null);
  readonly error = signal('');
  private skew = 0;

  async load() {
    try {
      const h = await this.api.riderHome();
      this.skew = h.serverTime - Date.now();
      this.home.set(h);
    } catch (e) {
      this.error.set(String((e as { error?: { message?: string } }).error?.message ?? e));
    }
  }

  serverNow() {
    return Date.now() + this.skew;
  }
}

@Component({
  selector: 'fx-rider-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="fx fx-console rider">
      <header class="fx-top">
        <div class="fx-wrap">
          <a class="fx-logo" routerLink="/rider"><i>🛵</i><span>NexEats <small style="font-weight:500;opacity:.8">Delivery</small></span></a>
          @if (state.home(); as h) {
            <button class="fx-toggle" [class.on]="h.profile.online" (click)="toggle()" [disabled]="busy()"><i></i>{{ h.profile.online ? 'Online' : 'Offline' }}</button>
          }
          <span class="grow"></span>
          <nav class="fx-toplinks">
            <a routerLink="/rider" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Trip</a>
            <a routerLink="/rider/earnings" routerLinkActive="active">Earnings</a>
          </nav>
          <button class="fx-btn sm ghost" style="color:#fff;border-color:rgb(255 255 255 / 35%)" (click)="auth.logout()">Sign out</button>
        </div>
      </header>
      <router-outlet />
    </div>
  `,
})
export class RiderShell implements OnInit {
  auth = inject(AuthService);
  state = inject(RiderState);
  private api = inject(FoodApi);
  private hub = inject(EventHub);
  busy = signal(false);

  ngOnInit() {
    this.hub.connect();
    void this.state.load();
  }

  async toggle() {
    const h = this.state.home();
    if (!h) return;
    this.busy.set(true);
    try {
      await this.api.riderOnline(!h.profile.online);
      await this.state.load();
    } finally {
      this.busy.set(false);
    }
  }
}
