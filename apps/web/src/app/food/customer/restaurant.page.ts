import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { FoodApi, MenuItem, Restaurant, rupees, themeBg } from '../food.api';
import { AddressStore, CartStore } from '../shared/stores';
import { distanceKm } from '../shared/geo';
import { errorMessage } from '../../core/api.service';

@Component({
  selector: 'fx-restaurant',
  imports: [RouterLink, FormsModule],
  template: `
    <div class="fx-wrap">
      @if (error()) { <div class="fx-empty"><span>😕</span><b>{{ error() }}</b><a class="fx-chip" routerLink="/">Back to restaurants</a></div> }
      @if (r(); as r) {
        <p class="fx-muted" style="margin:14px 0 0"><a routerLink="/">Home</a> / {{ r.area }} / {{ r.name }}</p>
        <section class="fx-rhead">
          <div class="hero">
            <div class="emoji" [style.background]="bg(r.theme)">{{ r.emoji }}</div>
            <div>
              <h1>{{ r.name }}</h1>
              <div class="fx-muted">{{ r.cuisines }}</div>
            </div>
          </div>
          <div class="line">
            <span class="fx-star">★ {{ r.rating }}</span><span class="fx-muted">({{ r.ratingCount }}+ ratings)</span>
            <span>·</span><b>{{ money(r.costForTwo) }} for two</b>
          </div>
          <div class="line fx-muted"><span>📍 {{ r.area }} · {{ dist() }} km</span><span>⏱ {{ eta() }} mins</span>@if (r.veg) {<span class="fx-veg"></span> Pure veg}</div>
          @if (!r.isOpen) { <div class="fx-deal" style="border-color:var(--bad);color:var(--bad)">Closed right now · {{ r.offer }}. You can browse the menu.</div> }
          <div class="fx-dealbar">
            @if (r.isOpen) { <div class="fx-deal">🏷️ <span><b>{{ r.offer }}</b></span></div> }
            <div class="fx-deal">🎟️ <span>Use <b>WELCOME50</b> at checkout</span></div>
            <div class="fx-deal">🚚 <span><b>FREEDEL</b> above ₹199</span></div>
          </div>
        </section>

        <div class="fx-menu-tools">
          <div class="fx-search" style="margin:0;flex:1"><span>🔍</span><input placeholder="Search in menu" [(ngModel)]="q" (ngModelChange)="query.set($event)" /></div>
          <button class="fx-chip" [class.on]="vegOnly()" (click)="vegOnly.set(!vegOnly())"><span class="fx-veg"></span> Veg</button>
          <button class="fx-chip" [class.on]="bestOnly()" (click)="bestOnly.set(!bestOnly())">★ Bestseller</button>
        </div>

        @for (c of categories(); track c.name) {
          <h3 class="fx-cat"><span>{{ c.name }} ({{ c.items.length }})</span></h3>
          @for (m of c.items; track m.id) {
            <div class="fx-dish" [class.off]="!m.available">
              <div class="info">
                <span [class]="m.veg ? 'fx-veg' : 'fx-nonveg'" [attr.aria-label]="m.veg ? 'Veg' : 'Non-veg'"></span>
                @if (m.bestseller) { <span class="best">★ Bestseller</span> }
                <b>{{ m.name }}</b>
                <span>{{ money(m.price) }}</span>
                <p>{{ m.description }}</p>
                @if (!m.available) { <small class="fx-muted">Sold out for today</small> }
              </div>
              <div class="pic" [style.background]="bgSoft(r.theme)">
                {{ m.emoji }}
                @if (cart.qty(m.id); as q) {
                  <div class="fx-stepper"><button (click)="cart.dec(m.id)" aria-label="Remove one">−</button><span>{{ q }}</span><button (click)="cart.inc(m.id)" aria-label="Add one">+</button></div>
                } @else {
                  <button class="fx-add" [disabled]="!m.available || !r.isOpen" (click)="cart.add(m, r.name)">ADD</button>
                }
              </div>
            </div>
          }
        } @empty {
          <div class="fx-empty"><span>🔎</span><b>No dishes match</b></div>
        }
        <div style="height:40px"></div>
      }
    </div>
    @if (cart.count()) {
      <a class="fx-cartbar" routerLink="/cart"><span>{{ cart.count() }} item{{ cart.count() > 1 ? 's' : '' }} · {{ money(cart.subtotal()) }}<small>from {{ cart.restaurantName() }}</small></span><span>View cart ›</span></a>
    }
  `,
})
export class RestaurantPage implements OnInit {
  readonly id = input.required<string>();
  private api = inject(FoodApi);
  private addr = inject(AddressStore);
  cart = inject(CartStore);

  r = signal<Restaurant | null>(null);
  menu = signal<MenuItem[]>([]);
  error = signal('');
  q = '';
  query = signal('');
  vegOnly = signal(false);
  bestOnly = signal(false);

  dist = computed(() => {
    const r = this.r(), a = this.addr.current();
    return r ? Math.round(distanceKm([a.lat, a.lng], [r.lat, r.lng]) * 10) / 10 : 0;
  });
  eta = computed(() => Math.round((this.r()?.prepMinutes ?? 15) + 9 + this.dist() * 3.2));

  categories = computed(() => {
    const q = this.query().trim().toLowerCase();
    let items = this.menu();
    if (q) items = items.filter((m) => `${m.name} ${m.description}`.toLowerCase().includes(q));
    if (this.vegOnly()) items = items.filter((m) => m.veg);
    if (this.bestOnly()) items = items.filter((m) => m.bestseller);
    const map = new Map<string, MenuItem[]>();
    if (!q && !this.bestOnly()) {
      const best = items.filter((m) => m.bestseller);
      if (best.length) map.set('Recommended', best);
    }
    for (const m of items) map.set(m.category, [...(map.get(m.category) ?? []), m]);
    return [...map.entries()].map(([name, list]) => ({ name, items: list }));
  });

  bg = themeBg;
  money = rupees;
  bgSoft(theme: string) {
    const [a, b] = (theme || '#f97316,#facc15').split(',');
    return `linear-gradient(135deg, color-mix(in srgb, ${a} 22%, white), color-mix(in srgb, ${b} 28%, white))`;
  }

  async ngOnInit() {
    try {
      const res = await this.api.restaurant(this.id());
      this.r.set(res.restaurant);
      this.menu.set(res.menu);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}
