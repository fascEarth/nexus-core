import { Component, computed, DestroyRef, inject, input, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { EventHub } from '../../core/event-hub.service';
import { errorMessage } from '../../core/api.service';
import { FoodApi, Track, rupees, themeBg } from '../food.api';
import { FoodMap, MapLine, MapMarker } from '../shared/food-map';
import { LatLng, along, roadRoute } from '../shared/geo';

const STEPS = [
  { state: 'placed', label: 'Order placed', icon: '🧾', hint: 'Waiting for the restaurant to confirm' },
  { state: 'accepted', label: 'Preparing your food', icon: '👨‍🍳', hint: 'The kitchen is on it' },
  { state: 'ready', label: 'Food is ready', icon: '🛍️', hint: 'Packed and waiting for the rider' },
  { state: 'picked_up', label: 'Out for delivery', icon: '🛵', hint: 'Your rider is on the way' },
  { state: 'delivered', label: 'Delivered', icon: '🏠', hint: 'Enjoy your meal!' },
];
const ORDER = STEPS.map((s) => s.state);

/** Tracks one order live: workflow state from the API, rider position simulated along a road route. */
@Component({
  selector: 'fx-track',
  imports: [FoodMap, DatePipe, FormsModule, RouterLink],
  template: `
    <div class="fx-wrap" style="padding-top:16px">
      @if (error()) { <div class="fx-empty"><span>😕</span><b>{{ error() }}</b><a class="fx-chip" routerLink="/orders">Your orders</a></div> }
      @if (t(); as t) {
        <div class="fx-two">
          <div class="fx-stack">
            @if (final()) {
              <div class="fx-eta" [class.dead]="t.order.status !== 'delivered'">
                <div><small>{{ t.order.number }}</small><b>{{ t.order.status === 'delivered' ? 'Delivered 🎉' : t.order.status === 'cancelled' ? 'Order cancelled' : 'Declined by restaurant' }}</b>
                  <small>{{ t.order.status === 'delivered' ? 'in ' + (t.order.deliveryMinutes ?? t.order.etaMinutes) + ' mins' : t.order.cancelReason }}{{ t.order.paymentStatus === 'refunded' ? ' · refund of ' + money(t.order.total) + ' initiated' : '' }}</small></div>
                <span style="font-size:40px">{{ t.order.status === 'delivered' ? '✅' : '🚫' }}</span>
              </div>
            } @else {
              <div class="fx-eta">
                <div><small>{{ t.order.number }} · {{ currentStep().label }}</small><b>Arriving in {{ etaLeft() }} mins</b><small>{{ currentStep().hint }}</small></div>
                <span style="font-size:40px">{{ currentStep().icon }}</span>
              </div>
            }
            <fx-map class="fx-track-map" [markers]="markers()" [lines]="lines()" [fitKey]="fitKey()" />
            @if (t.rider && !final()) {
              <section class="fx-card fx-rider-card">
                <div class="face">🧑🏽‍🦱</div>
                <div style="flex:1"><b>{{ t.rider.name }}</b> is your delivery partner<br /><small class="fx-muted">{{ t.rider.vehicle }} · ★ {{ t.rider.rating }} · {{ t.delivery?.status === 'assigned' ? 'heading to the restaurant' : 'on the way to you' }}</small></div>
                <a class="fx-btn sm ghost" [href]="'tel:' + t.rider.phone">📞 Call</a>
              </section>
            } @else if (!final() && t.order.status !== 'placed') {
              <section class="fx-card"><small class="fx-muted">🔎 Finding a delivery partner near {{ t.restaurant.name }}…</small></section>
            }
            @if (t.order.status === 'delivered' && !t.order.foodRating) {
              <section class="fx-card fx-stack">
                <h3 style="margin:0">How was your food from {{ t.restaurant.name }}?</h3>
                <div class="fx-stars">@for (s of [1, 2, 3, 4, 5]; track s) { <button [class.on]="food() >= s" (click)="food.set(s)" [attr.aria-label]="s + ' stars'">⭐</button> }</div>
                @if (t.rider || t.order.riderName) {
                  <small class="fx-muted">Rate {{ t.order.riderName }}</small>
                  <div class="fx-stars">@for (s of [1, 2, 3, 4, 5]; track s) { <button [class.on]="rider() >= s" (click)="rider.set(s)" [attr.aria-label]="'Rider ' + s + ' stars'">⭐</button> }</div>
                }
                <textarea rows="2" placeholder="Tell us more (optional)" [(ngModel)]="review"></textarea>
                <button class="fx-btn" [disabled]="!food() || busy()" (click)="rate()">Submit rating</button>
              </section>
            } @else if (t.order.foodRating) {
              <section class="fx-card"><b>You rated this order {{ t.order.foodRating }}★</b>@if (t.order.review) {<p class="fx-muted" style="margin:6px 0 0">“{{ t.order.review }}”</p>}</section>
            }
          </div>

          <div class="fx-stack">
            <section class="fx-card">
              <h3>Order status</h3>
              <div class="fx-steps">
                @for (s of steps; track s.state; let i = $index) {
                  <div class="fx-step" [class.done]="stepIndex() > i || t.order.status === 'delivered'" [class.now]="stepIndex() === i && !final()">
                    <i>{{ stepIndex() > i || t.order.status === 'delivered' ? '✓' : i + 1 }}</i>
                    <div><b>{{ s.label }}</b><br /><small class="fx-muted">{{ s.hint }}</small></div>
                    <small class="fx-muted">{{ at(s.state) | date: 'shortTime' }}</small>
                  </div>
                }
              </div>
              @if (t.order.status === 'placed') {
                <button class="fx-btn ghost" (click)="cancel()" [disabled]="busy()">Cancel order</button>
                <small class="fx-muted">You can cancel until the restaurant accepts. Prepaid amounts are refunded automatically.</small>
              }
            </section>

            <section class="fx-card fx-bill">
              <div class="fx-order"><div class="emoji" [style.background]="bg(t.restaurant.theme)">{{ t.restaurant.emoji }}</div><div><b>{{ t.restaurant.name }}</b><br /><small class="fx-muted">{{ t.restaurant.area }}</small></div></div>
              @for (l of t.order.items; track l.id) {
                <div class="row2"><span><span [class]="l.veg ? 'fx-veg' : 'fx-nonveg'"></span> {{ l.name }} × {{ l.qty }}</span><span>{{ money(l.price * l.qty) }}</span></div>
              }
              <div class="row2"><span>Delivery fee</span><span>{{ money(t.order.deliveryFee) }}</span></div>
              <div class="row2"><span>Platform fee &amp; taxes</span><span>{{ money(t.order.platformFee + t.order.taxes) }}</span></div>
              @if (t.order.discount) { <div class="row2 save"><span>Discount ({{ t.order.coupon }})</span><span>−{{ money(t.order.discount) }}</span></div> }
              <div class="row2 total"><span>{{ t.order.paymentMethod === 'cod' ? 'To pay on delivery' : 'Paid via ' + t.order.paymentMethod.toUpperCase() }}</span><span>{{ money(t.order.total) }}</span></div>
              <small class="fx-muted" style="display:block;margin-top:8px">🏠 {{ t.order.address }}</small>
              @if (t.order.paymentRef) { <small class="fx-muted" style="display:block">Payment ref {{ t.order.paymentRef }} (demo)</small> }
            </section>
          </div>
        </div>
      }
    </div>
  `,
})
export class TrackPage implements OnInit {
  readonly id = input.required<string>();
  private api = inject(FoodApi);
  private hub = inject(EventHub);
  private destroyRef = inject(DestroyRef);

  steps = STEPS;
  t = signal<Track | null>(null);
  error = signal('');
  now = signal(Date.now());
  busy = signal(false);
  food = signal(0);
  rider = signal(0);
  review = '';
  private skew = 0;
  private approach = signal<LatLng[]>([]);
  private drop = signal<LatLng[]>([]);
  private routedFor = '';

  final = computed(() => ['delivered', 'cancelled', 'rejected'].includes(this.t()?.order.status ?? ''));
  stepIndex = computed(() => Math.max(0, ORDER.indexOf(this.t()?.order.status ?? 'placed')));
  currentStep = computed(() => STEPS[this.stepIndex()]);
  fitKey = computed(() => `${this.t()?.order.id}:${this.t()?.delivery?.status ?? 'none'}:${this.drop().length}`);

  /** Simulated rider position from the trip's timestamps (server clock). */
  riderAt = computed<LatLng | null>(() => {
    const t = this.t(), d = t?.delivery;
    if (!t || !d || d.status === 'cancelled') return null;
    const now = this.now() + this.skew;
    if (d.status === 'delivered' || t.order.status === 'delivered') return [d.dropLat, d.dropLng];
    if (d.status === 'picked_up') {
      const p = (now - new Date(d.pickedUpAt ?? d.updatedAt).getTime()) / (d.travelSeconds * 1000);
      return along(this.drop().length ? this.drop() : [[d.pickupLat, d.pickupLng], [d.dropLat, d.dropLng]], Math.min(0.97, p));
    }
    const p = (now - new Date(d.assignedAt).getTime()) / (d.approachSeconds * 1000);
    return along(this.approach().length ? this.approach() : [[d.startLat, d.startLng], [d.pickupLat, d.pickupLng]], p);
  });

  markers = computed<MapMarker[]>(() => {
    const t = this.t();
    if (!t) return [];
    const list: MapMarker[] = [
      { id: 'r', at: [t.restaurant.lat, t.restaurant.lng], icon: t.restaurant.emoji, kind: 'restaurant', title: t.restaurant.name },
      { id: 'h', at: [t.order.dropLat, t.order.dropLng], icon: '🏠', kind: 'home', title: 'You' },
    ];
    const r = this.riderAt();
    if (r && !this.final()) list.push({ id: 'rider', at: r, icon: '🛵', kind: 'rider', title: t.rider?.name });
    return list;
  });

  lines = computed<MapLine[]>(() => {
    const d = this.t()?.delivery;
    const out: MapLine[] = [];
    if (this.drop().length) out.push({ id: 'drop', points: this.drop(), color: '#f2542d' });
    if (d?.status === 'assigned' && this.approach().length) out.push({ id: 'approach', points: this.approach(), color: '#6b7280', dashed: true });
    return out;
  });

  etaLeft = computed(() => {
    const t = this.t();
    if (!t) return 0;
    const d = t.delivery, now = this.now() + this.skew;
    const since = (iso: string) => (now - new Date(iso).getTime()) / 1000;
    const prep = t.order.prepSeconds ?? 45, travel = d?.travelSeconds ?? 70, approach = d?.approachSeconds ?? 35;
    let left: number;
    switch (t.order.status) {
      case 'placed': left = 25 + prep + travel; break;
      case 'accepted': left = Math.max(5, prep - since(t.order.updatedAt)) + travel + 8; break;
      case 'ready': left = Math.max(5, approach - (d ? since(d.assignedAt) : 0)) + travel; break;
      default: left = Math.max(10, travel - (d?.pickedUpAt ? since(d.pickedUpAt) : 0));
    }
    // Demo time runs ~10× faster than real life: show real-world minutes.
    return Math.max(1, Math.round((left * 10) / 60));
  });

  bg = themeBg;
  money = rupees;

  ngOnInit() {
    void this.load();
    this.hub.connect();
    const stopOrder = this.hub.watch('order');
    const stopDelivery = this.hub.watch('delivery');
    this.destroyRef.onDestroy(() => { stopOrder(); stopDelivery(); });
    this.hub.events$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((e) => {
      const t = this.t();
      if (!t) return;
      if (e.entity?.id === t.order.id || e.entity?.id === t.delivery?.id || (e.entity?.name === 'delivery' && !t.delivery)) void this.load();
    });
    const tick = setInterval(() => this.now.set(Date.now()), 1000);
    const poll = setInterval(() => { if (!this.final()) void this.load(); }, 8000);
    this.destroyRef.onDestroy(() => { clearInterval(tick); clearInterval(poll); });
  }

  async load() {
    try {
      const t = await this.api.track(this.id());
      this.skew = t.serverTime - Date.now();
      this.t.set(t);
      this.error.set('');
      const d = t.delivery;
      const key = d ? `${d.id}` : `none:${t.order.id}`;
      if (key !== this.routedFor) {
        this.routedFor = key;
        const pickup: LatLng = [t.restaurant.lat, t.restaurant.lng], home: LatLng = [t.order.dropLat, t.order.dropLng];
        void roadRoute(pickup, home).then((p) => this.drop.set(p));
        if (d) void roadRoute([d.startLat, d.startLng], pickup).then((p) => this.approach.set(p));
      }
    } catch (e) {
      if (!this.t()) this.error.set(errorMessage(e));
    }
  }

  at(state: string) {
    return [...(this.t()?.timeline ?? [])].reverse().find((x) => x.state === state)?.at ?? null;
  }

  async cancel() {
    this.busy.set(true);
    try {
      await this.api.cancel(this.id(), 'Changed my mind');
      await this.load();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async rate() {
    this.busy.set(true);
    try {
      await this.api.rate(this.id(), { foodRating: this.food(), riderRating: this.rider() || undefined, review: this.review || undefined });
      await this.load();
    } finally {
      this.busy.set(false);
    }
  }
}
