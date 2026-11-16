import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EventHub } from '../../core/event-hub.service';
import { errorMessage } from '../../core/api.service';
import { FoodApi, Order, PartnerBoard, STATUS_LABEL, rupees } from '../food.api';
import { PartnerContext } from './partner-shell';

const REASONS = ['Item out of stock', 'Kitchen is too busy', 'Closing soon', 'Cannot deliver to this area'];

@Component({
  selector: 'fx-board',
  imports: [DatePipe, FormsModule],
  template: `
    <div class="fx-wrap">
      @if (b(); as b) {
        <div class="fx-kpis">
          <div class="fx-kpi"><small>Orders today</small><b>{{ b.today.orders }}</b></div>
          <div class="fx-kpi"><small>Delivered</small><b>{{ b.today.delivered }}</b></div>
          <div class="fx-kpi"><small>Food sales today</small><b>{{ money(b.today.sales) }}</b></div>
          <div class="fx-kpi"><small>Declined</small><b>{{ b.today.declined }}</b></div>
          <div class="fx-kpi"><small>Live orders</small><b class="fx-eat">{{ b.active.length }}</b></div>
        </div>
        <p class="fx-muted" style="margin-top:-6px">New orders appear instantly. If nobody responds within ~25 seconds the demo autopilot accepts for you.</p>
        <div class="fx-board">
          @for (col of columns; track col.state) {
            <section class="fx-col">
              <h3>{{ col.title }} <span class="pill">{{ byState(col.state).length }}</span></h3>
              @for (o of byState(col.state); track o.id) {
                <article class="fx-ticket" [class.new]="o.status === 'placed'">
                  <div class="head"><b>{{ o.number }}</b><span class="fx-timer" [class.late]="mins(o) >= 3">{{ clock(o) }}</span></div>
                  <small class="fx-muted">{{ o.customerName }} · {{ o.paymentMethod === 'cod' ? 'Cash on delivery' : 'Prepaid' }} · {{ money(o.itemTotal) }}</small>
                  <ul>@for (l of o.items; track l.id) { <li><span [class]="l.veg ? 'fx-veg' : 'fx-nonveg'"></span>{{ l.qty }} × {{ l.name }}</li> }</ul>
                  @if (o.notes) { <small style="background:var(--eat-soft);padding:6px 8px;border-radius:8px">📝 {{ o.notes }}</small> }
                  @if (o.riderName) { <small class="fx-muted">🛵 {{ o.riderName }} {{ o.status === 'picked_up' ? 'picked up' : 'assigned' }}</small> }
                  <div class="acts">
                    @switch (o.status) {
                      @case ('placed') {
                        <button class="fx-btn sm green" (click)="act(o, 'accept')" [disabled]="busy() === o.id">Accept</button>
                        <button class="fx-btn sm ghost" (click)="rejecting.set(o)">Decline</button>
                      }
                      @case ('accepted') { <button class="fx-btn sm" (click)="act(o, 'ready')" [disabled]="busy() === o.id">Mark food ready</button> }
                      @case ('ready') { <small class="fx-muted">Waiting for the rider to pick up</small> }
                      @case ('picked_up') { <small class="fx-muted">On the way to the customer</small> }
                    }
                  </div>
                </article>
              } @empty { <small class="fx-muted" style="padding:8px">Nothing here</small> }
            </section>
          }
        </div>

        <h2>Recent orders</h2>
        <div class="fx-card" style="overflow:auto">
          <table class="fx-table">
            <thead><tr><th>Order</th><th>Time</th><th>Customer</th><th>Items</th><th>Amount</th><th>Status</th><th>Rating</th></tr></thead>
            <tbody>
              @for (o of b.recent; track o.id) {
                <tr><td>{{ o.number }}</td><td>{{ o.createdAt | date: 'shortTime' }}</td><td>{{ o.customerName }}</td><td>{{ o.itemCount }}</td><td>{{ money(o.itemTotal) }}</td><td><span class="fx-status" [class]="o.status">{{ label(o.status) }}</span></td><td>{{ o.foodRating ? '★ ' + o.foodRating : '–' }}</td></tr>
              } @empty { <tr><td colspan="7" class="fx-muted">No completed orders in the last 24 hours</td></tr> }
            </tbody>
          </table>
        </div>
      } @else if (error()) { <div class="fx-empty"><span>⚠️</span><b>{{ error() }}</b></div> } @else { <p class="fx-muted" style="padding:20px">Loading orders…</p> }
    </div>

    @if (rejecting(); as o) {
      <div class="fx-overlay" (click)="rejecting.set(null)">
        <div class="fx-sheet" (click)="$event.stopPropagation()">
          <h3>Decline {{ o.number }}?</h3>
          <p class="fx-muted" style="margin:0">The customer is notified and any prepaid amount is refunded automatically.</p>
          @for (r of reasons; track r) { <button class="fx-addr-opt" [class.on]="reason === r" (click)="reason = r">{{ r }}</button> }
          <button class="fx-btn" [disabled]="!reason" (click)="act(o, 'reject', reason); rejecting.set(null)">Decline order</button>
        </div>
      </div>
    }
    @if (toast()) { <div class="fx-toast">🔔 {{ toast() }}</div> }
  `,
})
export class BoardPage implements OnInit {
  private api = inject(FoodApi);
  private hub = inject(EventHub);
  private ctx = inject(PartnerContext);
  private destroyRef = inject(DestroyRef);

  b = signal<PartnerBoard | null>(null);
  error = signal('');
  busy = signal<string | null>(null);
  rejecting = signal<Order | null>(null);
  toast = signal('');
  now = signal(Date.now());
  reason = '';
  reasons = REASONS;
  private skew = 0;
  private known = new Set<string>();
  columns = [
    { state: 'placed', title: '🆕 New' }, { state: 'accepted', title: '👨‍🍳 Preparing' },
    { state: 'ready', title: '🛍️ Ready' }, { state: 'picked_up', title: '🛵 Picked up' },
  ];
  money = rupees;
  private grouped = computed(() => {
    const m = new Map<string, Order[]>();
    for (const o of this.b()?.active ?? []) m.set(o.status, [...(m.get(o.status) ?? []), o]);
    return m;
  });

  constructor() {
    effect(() => {
      this.ctx.restaurantId();
      untracked(() => void this.load());
    });
  }

  ngOnInit() {
    const stop = this.hub.watch('order');
    this.hub.events$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((e) => {
      if (e.entity?.name === 'order' || e.entity?.name === 'delivery') void this.load();
    });
    const tick = setInterval(() => this.now.set(Date.now()), 1000);
    const poll = setInterval(() => void this.load(), 10_000);
    this.destroyRef.onDestroy(() => { stop(); clearInterval(tick); clearInterval(poll); });
  }

  async load() {
    try {
      const b = await this.api.board(this.ctx.restaurantId());
      this.skew = b.serverTime - Date.now();
      const fresh = b.active.filter((o) => o.status === 'placed' && !this.known.has(o.id));
      if (this.b() && fresh.length) {
        this.toast.set(`New order ${fresh[0].number} · ${fresh[0].itemCount} items`);
        setTimeout(() => this.toast.set(''), 4000);
      }
      for (const o of b.active) this.known.add(o.id);
      this.b.set(b);
      this.ctx.restaurant.set(b.restaurant);
      if (b.restaurants) this.ctx.restaurants.set(b.restaurants);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  byState(s: string) {
    return this.grouped().get(s) ?? [];
  }

  mins(o: Order) {
    return Math.floor((this.now() + this.skew - new Date(o.updatedAt).getTime()) / 60_000);
  }

  clock(o: Order) {
    const s = Math.max(0, Math.floor((this.now() + this.skew - new Date(o.updatedAt).getTime()) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  label(s: string) {
    return STATUS_LABEL[s] ?? s;
  }

  async act(o: Order, action: 'accept' | 'reject' | 'ready', comment?: string) {
    this.busy.set(o.id);
    try {
      await this.api.partnerAction(o.id, action, comment);
      await this.load();
    } catch (e) {
      this.toast.set(errorMessage(e));
      setTimeout(() => this.toast.set(''), 4000);
      await this.load();
    } finally {
      this.busy.set(null);
    }
  }
}
