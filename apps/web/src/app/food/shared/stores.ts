import { computed, Injectable, signal } from '@angular/core';
import type { MenuItem } from '../food.api';

export interface CartLine { id: string; name: string; price: number; veg: boolean; emoji: string; qty: number }
export interface Address { label: string; line: string; lat: number; lng: number }

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: keep in memory */
  }
}

/** The basket: one restaurant at a time, kept across reloads. */
@Injectable({ providedIn: 'root' })
export class CartStore {
  readonly restaurantId = signal<string | null>(read('nexeats.cart', { restaurantId: null as string | null }).restaurantId);
  readonly restaurantName = signal<string>(read('nexeats.cart', { restaurantName: '' }).restaurantName);
  readonly lines = signal<CartLine[]>(read('nexeats.cart', { lines: [] as CartLine[] }).lines);
  readonly coupon = signal<string>('');
  readonly notes = signal<string>('');
  /** Set when the user adds a dish from another restaurant: the UI asks before replacing. */
  readonly pendingSwitch = signal<{ item: MenuItem; restaurantName: string } | null>(null);

  readonly count = computed(() => this.lines().reduce((s, l) => s + l.qty, 0));
  readonly subtotal = computed(() => this.lines().reduce((s, l) => s + l.qty * l.price, 0));

  qty(id: string) {
    return this.lines().find((l) => l.id === id)?.qty ?? 0;
  }

  add(item: MenuItem, restaurantName: string) {
    if (this.restaurantId() && this.restaurantId() !== item.restaurantId && this.count()) {
      this.pendingSwitch.set({ item, restaurantName });
      return;
    }
    this.restaurantId.set(item.restaurantId);
    this.restaurantName.set(restaurantName);
    const existing = this.lines().find((l) => l.id === item.id);
    this.lines.set(existing
      ? this.lines().map((l) => (l.id === item.id ? { ...l, qty: l.qty + 1 } : l))
      : [...this.lines(), { id: item.id, name: item.name, price: item.price, veg: item.veg, emoji: item.emoji, qty: 1 }]);
    this.save();
  }

  confirmSwitch() {
    const p = this.pendingSwitch();
    this.pendingSwitch.set(null);
    if (!p) return;
    this.clear();
    this.add(p.item, p.restaurantName);
  }

  dec(id: string) {
    this.lines.set(this.lines().map((l) => (l.id === id ? { ...l, qty: l.qty - 1 } : l)).filter((l) => l.qty > 0));
    if (!this.lines().length) this.clear();
    this.save();
  }

  inc(id: string) {
    this.lines.set(this.lines().map((l) => (l.id === id ? { ...l, qty: Math.min(20, l.qty + 1) } : l)));
    this.save();
  }

  clear() {
    this.lines.set([]);
    this.restaurantId.set(null);
    this.restaurantName.set('');
    this.coupon.set('');
    this.notes.set('');
    this.save();
  }

  private save() {
    write('nexeats.cart', { restaurantId: this.restaurantId(), restaurantName: this.restaurantName(), lines: this.lines() });
  }
}

const DEFAULT_ADDRESSES: Address[] = [
  { label: 'Home', line: '12, Cross Cut Road, Gandhipuram, Coimbatore', lat: 11.0205, lng: 76.9645 },
  { label: 'Work', line: 'Hopes College, Avinashi Road, Peelamedu, Coimbatore', lat: 11.0262, lng: 77.0188 },
];

@Injectable({ providedIn: 'root' })
export class AddressStore {
  readonly list = signal<Address[]>(read('nexeats.addresses', DEFAULT_ADDRESSES));
  readonly selected = signal<number>(read('nexeats.address', 0));
  readonly current = computed(() => this.list()[this.selected()] ?? this.list()[0]);

  select(i: number) {
    this.selected.set(i);
    write('nexeats.address', i);
  }

  add(a: Address) {
    this.list.set([...this.list(), a]);
    write('nexeats.addresses', this.list());
    this.select(this.list().length - 1);
  }
}
