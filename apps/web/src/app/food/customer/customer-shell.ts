import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { EventHub } from '../../core/event-hub.service';
import { AddressStore, CartStore } from '../shared/stores';
import { FoodMap } from '../shared/food-map';
import type { LatLng } from '../shared/geo';

@Component({
  selector: 'fx-customer-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule, FoodMap],
  template: `
    <div class="fx">
      <div class="fx-demo-strip">Live demo · NexEats runs on Nexus Core · time runs ~10× faster <a routerLink="/login">Switch role</a></div>
      <header class="fx-top">
        <div class="fx-wrap">
          <a class="fx-logo" routerLink="/"><i>🍽</i><span>NexEats</span></a>
          <button class="fx-addr" (click)="addrOpen.set(true)" aria-label="Change delivery address">
            <b>📍 {{ addr.current().label }} ▾</b>
            <span>{{ addr.current().line }}</span>
          </button>
          <span class="grow"></span>
          <nav class="fx-toplinks">
            <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Home</a>
            <a routerLink="/search" routerLinkActive="active">Search</a>
            <a routerLink="/orders" routerLinkActive="active">Orders</a>
            <a routerLink="/cart" routerLinkActive="active">Cart @if (cart.count()) {<span class="badge">{{ cart.count() }}</span>}</a>
          </nav>
          @if (auth.loggedIn()) {
            <a class="fx-avatar" routerLink="/account" [title]="auth.me()?.name ?? ''">{{ initials() }}</a>
          } @else {
            <a class="fx-btn sm" routerLink="/login">Sign in</a>
          }
        </div>
      </header>

      <router-outlet />

      <nav class="fx-tabbar">
        <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }"><span>🏠</span>Home</a>
        <a routerLink="/search" routerLinkActive="active"><span>🔍</span>Search</a>
        <a routerLink="/cart" routerLinkActive="active"><span>🛒</span>Cart @if (cart.count()) {<i class="badge">{{ cart.count() }}</i>}</a>
        <a routerLink="/orders" routerLinkActive="active"><span>🧾</span>Orders</a>
      </nav>

      @if (cart.pendingSwitch(); as p) {
        <div class="fx-overlay" (click)="cart.pendingSwitch.set(null)">
          <div class="fx-sheet" (click)="$event.stopPropagation()">
            <h3>Replace cart items?</h3>
            <p class="fx-muted">Your cart has dishes from <b>{{ cart.restaurantName() }}</b>. Start a fresh cart with {{ p.item.name }} from {{ p.restaurantName }}?</p>
            <div class="fx-two" style="grid-template-columns:1fr 1fr">
              <button class="fx-btn ghost" (click)="cart.pendingSwitch.set(null)">No</button>
              <button class="fx-btn" (click)="cart.confirmSwitch()">Yes, start fresh</button>
            </div>
          </div>
        </div>
      }

      @if (addrOpen()) {
        <div class="fx-overlay" (click)="closeAddr()">
          <div class="fx-sheet" (click)="$event.stopPropagation()">
            <h3>Deliver to</h3>
            @for (a of addr.list(); track $index) {
              <button class="fx-addr-opt" [class.on]="$index === addr.selected()" (click)="addr.select($index); closeAddr()">
                <span>{{ a.label === 'Work' ? '🏢' : a.label === 'Home' ? '🏠' : '📍' }}</span>
                <span><b>{{ a.label }}</b><br /><small class="fx-muted">{{ a.line }}</small></span>
              </button>
            }
            <h3 style="margin-top:6px">Add an address</h3>
            <p class="fx-muted" style="margin:0">Tap the map to drop a pin.</p>
            <fx-map style="height:240px;border-radius:14px" [markers]="pin() ? [{ id: 'new', at: pin()!, icon: '📍', kind: 'home' }] : []" (picked)="pin.set($event)" />
            <div class="fx-two" style="grid-template-columns:1fr 2fr">
              <input placeholder="Label (e.g. Mom's place)" [(ngModel)]="label" />
              <input placeholder="Flat, street, landmark" [(ngModel)]="line" />
            </div>
            <button class="fx-btn" [disabled]="!pin() || line.trim().length < 5" (click)="saveAddr()">Save address</button>
          </div>
        </div>
      }

      @if (toast(); as t) {
        <div class="fx-toast" role="status"><span>🔔</span><span><b>{{ t.title }}</b>@if (t.body) {<br /><small>{{ t.body }}</small>}</span></div>
      }
    </div>
  `,
})
export class CustomerShell implements OnInit {
  auth = inject(AuthService);
  cart = inject(CartStore);
  addr = inject(AddressStore);
  private hub = inject(EventHub);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  addrOpen = signal(false);
  pin = signal<LatLng | null>(null);
  label = '';
  line = '';
  toast = signal<{ title: string; body?: string } | null>(null);

  initials() {
    return (this.auth.me()?.name ?? '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  }

  ngOnInit() {
    if (this.auth.loggedIn()) this.hub.connect();
    this.hub.notifications$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((n) => {
      this.toast.set({ title: n.title, body: n.body });
      setTimeout(() => this.toast.set(null), 4500);
    });
  }

  closeAddr() {
    this.addrOpen.set(false);
    this.pin.set(null);
  }

  saveAddr() {
    const p = this.pin();
    if (!p) return;
    this.addr.add({ label: this.label.trim() || 'Other', line: this.line.trim(), lat: p[0], lng: p[1] });
    this.label = this.line = '';
    this.closeAddr();
  }
}
