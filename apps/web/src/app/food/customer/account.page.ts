import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { AddressStore } from '../shared/stores';

@Component({
  selector: 'fx-account',
  imports: [RouterLink],
  template: `
    <div class="fx-wrap" style="padding-top:16px">
      @if (auth.me(); as me) {
        <section class="fx-card fx-stack">
          <div class="fx-order"><div class="emoji" style="background:var(--eat-soft)">🙂</div><div><h1>{{ me.name }}</h1><small class="fx-muted">{{ me.email }}</small></div></div>
          <a class="fx-btn ghost" routerLink="/orders">🧾 Your orders</a>
          @if (auth.hasRole('admin', 'ops')) { <a class="fx-btn dark" routerLink="/app/ops">🛰️ Open the admin console</a> }
          <button class="fx-btn ghost" (click)="auth.logout()">Sign out</button>
        </section>
        <h2>Saved addresses</h2>
        <div class="fx-stack">@for (a of addr.list(); track $index) { <div class="fx-card"><b>{{ a.label }}</b><br /><small class="fx-muted">{{ a.line }}</small></div> }</div>
        <h2>About this demo</h2>
        <p class="fx-muted">NexEats is a sample food-delivery business built entirely on Nexus Core: restaurants, menus, orders and riders are metadata records, order and delivery lifecycles are workflows, alerts are no-code rules, and every action flows through the event bus. Payments and rider movement are simulated, maps are OpenStreetMap.</p>
      } @else {
        <div class="fx-empty"><span>👋</span><b>You're browsing as a guest</b><a class="fx-btn sm" routerLink="/login">Sign in or create an account</a></div>
      }
    </div>
  `,
})
export class AccountPage {
  auth = inject(AuthService);
  addr = inject(AddressStore);
}
