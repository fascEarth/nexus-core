import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FoodApi, Coupon, Restaurant, themeBg, rupees } from '../food.api';
import { AddressStore, CartStore } from '../shared/stores';
import { distanceKm } from '../shared/geo';

const CUISINES: [label: string, emoji: string, match: string][] = [
  ['Biryani', '🍛', 'biryani'], ['South Indian', '🥞', 'south indian'], ['Pizza', '🍕', 'pizza'], ['Burgers', '🍔', 'burger'],
  ['Chinese', '🍜', 'chinese'], ['Healthy', '🥗', 'healthy'], ['Chaat', '🥙', 'chaat'], ['Desserts', '🍰', 'dessert'],
  ['Café', '☕', 'café'], ['Seafood', '🦐', 'seafood'],
];
type Sort = 'relevance' | 'rating' | 'time' | 'cost';

@Component({
  selector: 'fx-home',
  imports: [RouterLink],
  template: `
    <div class="fx-wrap">
      <a class="fx-search" routerLink="/search"><span>🔍</span><input placeholder="Search for restaurants and dishes" readonly tabindex="-1" /></a>

      @if (offers().length) {
        <div class="fx-rail">
          @for (o of offers(); track o.id) {
            <button class="fx-offer" [style.background]="bg(o.theme)" (click)="useCoupon(o)">
              <small>{{ o.kind === 'free_delivery' ? 'FREE DELIVERY' : o.kind === 'flat' ? 'FLAT ' + money(o.value) + ' OFF' : o.value + '% OFF' }}</small>
              <b>{{ o.title }}</b>
              <code>{{ copied() === o.code ? '✓ Added to cart' : o.code }}</code>
            </button>
          }
        </div>
      }

      <h2>What's on your mind?</h2>
      <div class="fx-cuisines">
        @for (c of cuisines; track c[0]) {
          <button class="fx-cuisine" [class.on]="cuisine() === c[2]" (click)="cuisine.set(cuisine() === c[2] ? '' : c[2])"><span>{{ c[1] }}</span>{{ c[0] }}</button>
        }
      </div>

      @if (!cuisine() && topRated().length) {
        <h2>Top rated near you</h2>
        <div class="fx-top-picks">
          @for (r of topRated(); track r.id) {
            <a class="fx-rcard" [routerLink]="['/r', r.id]">
              <div class="fx-rimg" [style.background]="bg(r.theme)">{{ r.emoji }}<span class="ribbon">{{ r.offer }}</span></div>
              <div class="fx-rinfo"><b>{{ r.name }}</b><div class="meta"><span class="fx-star">★ {{ r.rating }}</span> · {{ eta(r) }} mins</div></div>
            </a>
          }
        </div>
      }

      <h2>{{ list().length }} restaurants to explore</h2>
      <div class="fx-filters">
        <button class="fx-chip" [class.on]="veg()" (click)="veg.set(!veg())">🟢 Pure veg</button>
        <button class="fx-chip" [class.on]="rated()" (click)="rated.set(!rated())">Ratings 4.3+</button>
        <button class="fx-chip" [class.on]="fast()" (click)="fast.set(!fast())">Fast delivery</button>
        <button class="fx-chip" [class.on]="openOnly()" (click)="openOnly.set(!openOnly())">Open now</button>
        <button class="fx-chip" [class.on]="sort() === 'rating'" (click)="toggleSort('rating')">Sort: rating</button>
        <button class="fx-chip" [class.on]="sort() === 'time'" (click)="toggleSort('time')">Sort: delivery time</button>
        <button class="fx-chip" [class.on]="sort() === 'cost'" (click)="toggleSort('cost')">Sort: cost</button>
      </div>

      @if (loading()) {
        <div class="fx-grid">@for (i of [1, 2, 3, 4, 5, 6]; track i) { <div class="fx-rimg" style="background:var(--line)"></div> }</div>
      } @else {
        <div class="fx-grid">
          @for (r of list(); track r.id) {
            <a class="fx-rcard" [class.closed]="!r.isOpen" [routerLink]="['/r', r.id]">
              <div class="fx-rimg" [style.background]="bg(r.theme)">
                {{ r.emoji }}
                @if (!r.isOpen) { <span class="tag">Closed · {{ r.offer }}</span> } @else if (r.veg) { <span class="tag">Pure veg</span> }
                @if (r.isOpen) { <span class="ribbon">{{ r.offer }}</span> }
              </div>
              <div class="fx-rinfo">
                <b>{{ r.name }}</b>
                <div class="meta"><span class="fx-star">★ {{ r.rating }}</span><span>· {{ eta(r) }} mins · {{ km(r) }} km</span></div>
                <div class="sub">{{ r.cuisines }}</div>
                <div class="sub">{{ r.area }} · {{ money(r.costForTwo) }} for two</div>
              </div>
            </a>
          } @empty {
            <div class="fx-empty"><span>🍽️</span><b>No restaurants match those filters</b><button class="fx-chip" (click)="reset()">Clear filters</button></div>
          }
        </div>
      }
    </div>
    @if (cart.count()) {
      <a class="fx-cartbar" routerLink="/cart"><span>{{ cart.count() }} item{{ cart.count() > 1 ? 's' : '' }} · {{ money(cart.subtotal()) }}<small>from {{ cart.restaurantName() }}</small></span><span>View cart ›</span></a>
    }
  `,
})
export class HomePage implements OnInit {
  private api = inject(FoodApi);
  private addr = inject(AddressStore);
  cart = inject(CartStore);
  cuisines = CUISINES;

  restaurants = signal<Restaurant[]>([]);
  offers = signal<Coupon[]>([]);
  loading = signal(true);
  cuisine = signal('');
  veg = signal(false);
  rated = signal(false);
  fast = signal(false);
  openOnly = signal(false);
  sort = signal<Sort>('relevance');
  copied = signal('');

  topRated = computed(() => [...this.restaurants()].filter((r) => r.isOpen).sort((a, b) => b.rating - a.rating).slice(0, 6));
  list = computed(() => {
    let l = this.restaurants();
    const c = this.cuisine();
    if (c) l = l.filter((r) => r.cuisines.toLowerCase().includes(c) || (c === 'dessert' && r.cuisines.toLowerCase().includes('ice cream')));
    if (this.veg()) l = l.filter((r) => r.veg);
    if (this.rated()) l = l.filter((r) => r.rating >= 4.3);
    if (this.fast()) l = l.filter((r) => this.eta(r) <= 30);
    if (this.openOnly()) l = l.filter((r) => r.isOpen);
    const s = this.sort();
    if (s === 'rating') l = [...l].sort((a, b) => b.rating - a.rating);
    if (s === 'time') l = [...l].sort((a, b) => this.eta(a) - this.eta(b));
    if (s === 'cost') l = [...l].sort((a, b) => a.costForTwo - b.costForTwo);
    return l;
  });

  bg = themeBg;
  money = rupees;

  async ngOnInit() {
    try {
      const [r, o] = await Promise.all([this.api.restaurants(), this.api.offers().catch(() => [])]);
      this.restaurants.set(r);
      this.offers.set(o);
    } finally {
      this.loading.set(false);
    }
  }

  km(r: Restaurant) {
    const a = this.addr.current();
    return Math.round(distanceKm([a.lat, a.lng], [r.lat, r.lng]) * 10) / 10;
  }

  eta(r: Restaurant) {
    return Math.round(r.prepMinutes + 9 + this.km(r) * 3.2);
  }

  toggleSort(s: Sort) {
    this.sort.set(this.sort() === s ? 'relevance' : s);
  }

  reset() {
    this.cuisine.set('');
    this.veg.set(false);
    this.rated.set(false);
    this.fast.set(false);
    this.openOnly.set(false);
  }

  useCoupon(o: Coupon) {
    this.cart.coupon.set(o.code);
    this.copied.set(o.code);
    setTimeout(() => this.copied.set(''), 2000);
  }
}
