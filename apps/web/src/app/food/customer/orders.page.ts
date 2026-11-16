import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { FoodApi, MenuItem, Order, STATUS_LABEL, rupees, themeBg } from '../food.api';
import { CartStore } from '../shared/stores';

@Component({
  selector: 'fx-orders',
  imports: [RouterLink, DatePipe],
  template: `
    <div class="fx-wrap" style="padding-top:16px">
      <h1>Your orders</h1>
      @if (!auth.loggedIn()) {
        <div class="fx-empty"><span>🧾</span><b>Sign in to see your orders</b><a class="fx-btn sm" routerLink="/login" [queryParams]="{ next: '/orders' }">Sign in</a></div>
      } @else if (loading()) {
        <p class="fx-muted">Loading…</p>
      } @else {
        @if (active().length) {
          <h2>On the way</h2>
          <div class="fx-stack">
            @for (o of active(); track o.id) {
              <a class="fx-card fx-order" [routerLink]="['/orders', o.id]" style="border-color:var(--eat)">
                <div class="emoji" [style.background]="bg(o.restaurantTheme)">{{ o.restaurantEmoji }}</div>
                <div style="flex:1"><b>{{ o.restaurantName }}</b><br /><small class="fx-muted">{{ o.number }} · {{ o.itemCount }} items · {{ money(o.total) }}</small></div>
                <span class="fx-status">{{ label(o.status) }} ›</span>
              </a>
            }
          </div>
        }
        <h2>Past orders</h2>
        <div class="fx-stack">
          @for (o of past(); track o.id) {
            <div class="fx-card fx-stack" style="gap:10px">
              <a class="fx-order" [routerLink]="['/orders', o.id]">
                <div class="emoji" [style.background]="bg(o.restaurantTheme)">{{ o.restaurantEmoji }}</div>
                <div style="flex:1"><b>{{ o.restaurantName }}</b><br /><small class="fx-muted">{{ o.number }} · {{ o.createdAt | date: 'd MMM, h:mm a' }}</small></div>
                <span class="fx-status" [class]="o.status">{{ label(o.status) }}</span>
              </a>
              <small class="fx-muted">{{ summary(o) }}</small>
              <div style="display:flex;justify-content:space-between;align-items:center">
                <b>{{ money(o.total) }}</b>
                <span style="display:flex;gap:8px">
                  @if (o.foodRating) { <span class="fx-star">★ {{ o.foodRating }}</span> }
                  <button class="fx-btn sm ghost" (click)="reorder(o)">↻ Reorder</button>
                </span>
              </div>
            </div>
          } @empty { <div class="fx-empty"><span>🍽️</span><b>No orders yet</b><a class="fx-btn sm" routerLink="/">Order something tasty</a></div> }
        </div>
      }
    </div>
  `,
})
export class OrdersPage implements OnInit {
  auth = inject(AuthService);
  private api = inject(FoodApi);
  private cart = inject(CartStore);
  private router = inject(Router);
  orders = signal<Order[]>([]);
  loading = signal(true);
  active = computed(() => this.orders().filter((o) => ['placed', 'accepted', 'ready', 'picked_up'].includes(o.status)));
  past = computed(() => this.orders().filter((o) => !['placed', 'accepted', 'ready', 'picked_up'].includes(o.status)));
  bg = themeBg;
  money = rupees;

  async ngOnInit() {
    if (!this.auth.loggedIn()) return;
    try {
      this.orders.set(await this.api.myOrders());
    } finally {
      this.loading.set(false);
    }
  }

  label(s: string) {
    return STATUS_LABEL[s] ?? s;
  }

  summary(o: Order) {
    return (o.items ?? []).map((l) => `${l.name} × ${l.qty}`).join(', ');
  }

  async reorder(o: Order) {
    const { restaurant, menu } = await this.api.restaurant(o.restaurantId);
    this.cart.clear();
    for (const l of o.items) {
      const m = menu.find((x: MenuItem) => x.id === l.id && x.available);
      if (m) for (let i = 0; i < l.qty; i++) this.cart.add(m, restaurant.name);
    }
    await this.router.navigateByUrl('/cart');
  }
}
