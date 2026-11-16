import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api.service';
import { FoodApi, MenuItem, rupees } from '../food.api';
import { PartnerContext } from './partner-shell';

@Component({
  selector: 'fx-partner-menu',
  imports: [FormsModule],
  template: `
    <div class="fx-wrap" style="padding-top:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div><h1>Menu</h1><small class="fx-muted">{{ items().length }} dishes · {{ soldOut() }} sold out · changes go live for customers instantly</small></div>
        <button class="fx-btn sm" (click)="adding.set(true)">+ Add dish</button>
      </div>
      @if (error()) { <p class="error">{{ error() }}</p> }
      @for (c of categories(); track c.name) {
        <h2>{{ c.name }}</h2>
        <div class="fx-card" style="padding:0 16px">
          @for (m of c.items; track m.id) {
            <div class="fx-line" style="border-bottom:1px solid var(--line)">
              <span [class]="m.veg ? 'fx-veg' : 'fx-nonveg'"></span>
              <span class="name"><b>{{ m.emoji }} {{ m.name }}</b>@if (m.bestseller) {<small class="fx-eat"> ★ Bestseller</small>}<br /><small class="fx-muted">{{ m.description }}</small></span>
              <input type="number" style="width:90px" [ngModel]="m.price" (change)="setPrice(m, $any($event.target).value)" [attr.aria-label]="'Price of ' + m.name" />
              <button class="fx-toggle" [class.on]="m.available" (click)="toggle(m)"><i></i><small>{{ m.available ? 'In stock' : 'Sold out' }}</small></button>
            </div>
          }
        </div>
      }
    </div>
    @if (adding()) {
      <div class="fx-overlay" (click)="adding.set(false)">
        <form class="fx-sheet" (click)="$event.stopPropagation()" (ngSubmit)="add()">
          <h3>New dish</h3>
          <label>Name<input name="name" [(ngModel)]="draft.name" required /></label>
          <div class="fx-two" style="grid-template-columns:1fr 1fr">
            <label>Price (₹)<input name="price" type="number" [(ngModel)]="draft.price" required /></label>
            <label>Category<input name="cat" [(ngModel)]="draft.category" list="cats" required /></label>
          </div>
          <datalist id="cats">@for (c of categories(); track c.name) { <option [value]="c.name"></option> }</datalist>
          <div class="fx-two" style="grid-template-columns:1fr 1fr">
            <label>Emoji<input name="emoji" [(ngModel)]="draft.emoji" maxlength="4" /></label>
            <label style="flex-direction:row;align-items:center;gap:8px;margin-top:22px"><input name="veg" type="checkbox" [(ngModel)]="draft.veg" /> Vegetarian</label>
          </div>
          <label>Description<textarea name="desc" rows="2" [(ngModel)]="draft.description"></textarea></label>
          <button class="fx-btn" type="submit" [disabled]="!draft.name || !draft.price || !draft.category">Add to menu</button>
        </form>
      </div>
    }
  `,
})
export class PartnerMenuPage {
  private api = inject(FoodApi);
  private ctx = inject(PartnerContext);
  items = signal<MenuItem[]>([]);
  error = signal('');
  adding = signal(false);
  draft = { name: '', price: 0, category: '', emoji: '🍽️', veg: true, description: '' };
  soldOut = computed(() => this.items().filter((m) => !m.available).length);
  categories = computed(() => {
    const map = new Map<string, MenuItem[]>();
    for (const m of this.items()) map.set(m.category, [...(map.get(m.category) ?? []), m]);
    return [...map.entries()].map(([name, items]) => ({ name, items }));
  });
  money = rupees;

  constructor() {
    effect(() => {
      this.ctx.restaurantId();
      untracked(() => void this.load());
    });
  }

  async load() {
    try {
      const res = await this.api.menu(this.ctx.restaurantId());
      this.items.set(res.menu);
      this.ctx.restaurant.set(res.restaurant);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  private patch(id: string, patch: Partial<MenuItem>) {
    this.items.set(this.items().map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  async toggle(m: MenuItem) {
    this.patch(m.id, { available: !m.available });
    try {
      await this.api.patchMenu(m.id, { available: !m.available });
    } catch (e) {
      this.patch(m.id, { available: m.available });
      this.error.set(errorMessage(e));
    }
  }

  async setPrice(m: MenuItem, value: string) {
    const price = Number(value);
    if (!price || price === m.price) return;
    try {
      await this.api.patchMenu(m.id, { price });
      this.patch(m.id, { price });
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  async add() {
    try {
      await this.api.addMenu({ ...this.draft, price: Number(this.draft.price), restaurantId: this.ctx.restaurantId() });
      this.adding.set(false);
      this.draft = { name: '', price: 0, category: '', emoji: '🍽️', veg: true, description: '' };
      await this.load();
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}
