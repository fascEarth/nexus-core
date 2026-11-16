import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { FoodApi, MenuItem, Restaurant, rupees, themeBg } from '../food.api';
import { CartStore } from '../shared/stores';

const POPULAR = ['Biryani', 'Dosa', 'Pizza', 'Burger', 'Paneer', 'Chai', 'Noodles', 'Ice cream'];

@Component({
  selector: 'fx-search-page',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="fx-wrap">
      <div class="fx-search"><span>🔍</span><input placeholder="Search for restaurants and dishes" [(ngModel)]="q" (ngModelChange)="typed($event)" autofocus /></div>
      @if (!q.trim()) {
        <h2>Popular searches</h2>
        <div class="fx-filters" style="flex-wrap:wrap">@for (p of popular; track p) { <button class="fx-chip" (click)="q = p; typed(p)">🔥 {{ p }}</button> }</div>
      } @else {
        @if (restaurants().length) {
          <h2>Restaurants</h2>
          <div class="fx-stack">
            @for (r of restaurants(); track r.id) {
              <a class="fx-card fx-order" [routerLink]="['/r', r.id]">
                <div class="emoji" [style.background]="bg(r.theme)">{{ r.emoji }}</div>
                <div><b>{{ r.name }}</b><br /><small class="fx-muted"><span class="fx-star">★ {{ r.rating }}</span> · {{ r.cuisines }} · {{ r.area }}</small></div>
              </a>
            }
          </div>
        }
        <h2>Dishes</h2>
        <div class="fx-stack">
          @for (d of dishes(); track d.id) {
            <div class="fx-card fx-line">
              <span [class]="d.veg ? 'fx-veg' : 'fx-nonveg'"></span>
              <span class="name"><b>{{ d.emoji }} {{ d.name }}</b><br /><a class="fx-muted" [routerLink]="['/r', d.restaurantId]">{{ d.restaurantName }} ›</a></span>
              <b>{{ money(d.price) }}</b>
              @if (cart.qty(d.id); as n) {
                <div class="fx-stepper"><button (click)="cart.dec(d.id)">−</button><span>{{ n }}</span><button (click)="cart.inc(d.id)">+</button></div>
              } @else {
                <button class="fx-add" [disabled]="!d.available || !d.isOpen" (click)="cart.add(d, d.restaurantName)">ADD</button>
              }
            </div>
          } @empty { <p class="fx-muted">{{ searching() ? 'Searching…' : 'No dishes found for “' + q + '”' }}</p> }
        </div>
      }
    </div>
    @if (cart.count()) {
      <a class="fx-cartbar" routerLink="/cart"><span>{{ cart.count() }} items · {{ money(cart.subtotal()) }}<small>from {{ cart.restaurantName() }}</small></span><span>View cart ›</span></a>
    }
  `,
})
export class SearchPage {
  private api = inject(FoodApi);
  cart = inject(CartStore);
  popular = POPULAR;
  q = '';
  restaurants = signal<Restaurant[]>([]);
  dishes = signal<(MenuItem & { isOpen: boolean })[]>([]);
  searching = signal(false);
  private timer?: ReturnType<typeof setTimeout>;
  bg = themeBg;
  money = rupees;

  typed(v: string) {
    clearTimeout(this.timer);
    this.searching.set(true);
    this.timer = setTimeout(async () => {
      const res = await this.api.search(v).catch(() => ({ restaurants: [], dishes: [] }));
      this.restaurants.set(res.restaurants);
      this.dishes.set(res.dishes);
      this.searching.set(false);
    }, 250);
  }
}
