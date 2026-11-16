import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { EventHub } from '../../core/event-hub.service';
import { errorMessage } from '../../core/api.service';
import { FoodApi, Live, STATUS_LABEL, rupees } from '../food.api';
import { FoodMap, MapLine, MapMarker } from '../shared/food-map';
import { LatLng, along } from '../shared/geo';

/** Live operations: every open order, rider and restaurant on one map, updated by the event bus. */
@Component({
  selector: 'fx-ops',
  imports: [FoodMap, DatePipe, RouterLink],
  template: `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div><h1 style="margin:0">Live operations</h1><small class="muted">Orders, riders and kitchens in Coimbatore · updates in real time from the event bus</small></div>
      <span style="display:flex;gap:8px">
        <a class="btn" href="/" target="_blank" rel="noopener">Customer app ↗</a>
        <a class="btn" href="/partner" target="_blank" rel="noopener">Restaurant app ↗</a>
        <a class="btn" href="/rider" target="_blank" rel="noopener">Rider app ↗</a>
      </span>
    </div>
    @if (error()) { <p class="error">{{ error() }}</p> }
    @if (d(); as d) {
      <div class="fx-kpis">
        <div class="fx-kpi"><small>Live orders</small><b style="color:#f2542d">{{ d.counters.activeOrders }}</b></div>
        <div class="fx-kpi"><small>Orders today</small><b>{{ d.counters.ordersToday }}</b></div>
        <div class="fx-kpi"><small>GMV today</small><b>{{ money(d.counters.gmvToday) }}</b></div>
        <div class="fx-kpi"><small>Riders online · busy</small><b>{{ d.counters.ridersOnline }} · {{ d.counters.ridersBusy }}</b></div>
        <div class="fx-kpi"><small>Kitchens open</small><b>{{ d.counters.openRestaurants }}/{{ d.counters.restaurants }}</b></div>
        <div class="fx-kpi"><small>Cancelled / declined today</small><b>{{ d.counters.cancelledToday }}</b></div>
      </div>
      <div class="fx-ops">
        <div>
          <fx-map class="fx-ops-map" [markers]="markers()" [lines]="lines()" [fitKey]="'ops'" [zoom]="12" />
          <div class="fx-legend"><span>🍽️ restaurant</span><span>🏠 customer</span><span>🛵 rider on a trip</span><span>🟢 rider free</span><span>Dashed line: rider heading to pickup</span></div>
        </div>
        <div class="fx-feed">
          <b>Live orders</b>
          @for (o of d.active; track o.id) {
            <a class="item" [routerLink]="['/app/order', o.id]">
              <b>{{ o.number }} · {{ o.restaurantName }}</b><span class="fx-status" [class]="o.status">{{ label(o.status) }}</span>
              <small class="muted">{{ o.customerName }} · {{ money(o.total) }} · {{ o.riderName ? '🛵 ' + o.riderName : 'no rider yet' }}</small><small class="muted">{{ o.createdAt | date: 'shortTime' }}</small>
            </a>
          } @empty { <p class="muted">No live orders right now.</p> }
          <b style="margin-top:8px">Latest</b>
          @for (o of d.recent.slice(0, 12); track o.id) {
            <a class="item" [routerLink]="['/app/order', o.id]"><span>{{ o.number }} · {{ o.restaurantName }}</span><span class="fx-status" [class]="o.status">{{ label(o.status) }}</span></a>
          }
        </div>
      </div>
    }
  `,
})
export class OpsPage implements OnInit {
  private api = inject(FoodApi);
  private hub = inject(EventHub);
  private destroyRef = inject(DestroyRef);
  d = signal<Live | null>(null);
  error = signal('');
  now = signal(Date.now());
  private skew = 0;
  money = rupees;

  private riderPos(id: string): LatLng | null {
    const d = this.d(), del = d?.deliveries.find((x) => x.ownerId === id);
    if (!del) return null;
    const now = this.now() + this.skew;
    if (del.status === 'picked_up') return along([[del.pickupLat, del.pickupLng], [del.dropLat, del.dropLng]], Math.min(0.97, (now - new Date(del.pickedUpAt ?? del.updatedAt).getTime()) / (del.travelSeconds * 1000)));
    return along([[del.startLat, del.startLng], [del.pickupLat, del.pickupLng]], (now - new Date(del.assignedAt).getTime()) / (del.approachSeconds * 1000));
  }

  markers = computed<MapMarker[]>(() => {
    const d = this.d();
    if (!d) return [];
    return [
      ...d.restaurants.map((r) => ({ id: 'r' + r.id, at: [r.lat, r.lng] as LatLng, icon: r.emoji, kind: (r.isOpen ? 'restaurant' : 'closed') as MapMarker['kind'], title: r.name })),
      ...d.active.map((o) => ({ id: 'h' + o.id, at: [o.dropLat, o.dropLng] as LatLng, icon: '🏠', kind: 'home' as const, title: `${o.number} · ${o.customerName}` })),
      ...d.riders.filter((r) => r.online || r.busy).map((r) => ({
        id: 'x' + r.id, at: this.riderPos(r.ownerId) ?? ([r.lat, r.lng] as LatLng), icon: r.busy ? '🛵' : '🟢', kind: (r.busy ? 'busy' : 'idle') as MapMarker['kind'], title: `${r.name}${r.busy ? ' · on a trip' : ' · free'}`,
      })),
    ];
  });

  lines = computed<MapLine[]>(() => (this.d()?.deliveries ?? []).map((del) => ({
    id: del.id, dashed: del.status === 'assigned', color: del.status === 'assigned' ? '#6b7280' : '#f2542d',
    points: del.status === 'assigned' ? [[del.startLat, del.startLng], [del.pickupLat, del.pickupLng]] : [[del.pickupLat, del.pickupLng], [del.dropLat, del.dropLng]],
  })));

  ngOnInit() {
    void this.load();
    this.hub.events$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((e) => {
      if (['order', 'delivery', 'rider_profile', 'restaurant'].includes(e.entity?.name ?? '')) this.queue();
    });
    const tick = setInterval(() => this.now.set(Date.now()), 1000);
    const poll = setInterval(() => void this.load(), 15_000);
    this.destroyRef.onDestroy(() => { clearInterval(tick); clearInterval(poll); });
  }

  private pending?: ReturnType<typeof setTimeout>;
  private queue() {
    clearTimeout(this.pending);
    this.pending = setTimeout(() => void this.load(), 600);
  }

  async load() {
    try {
      const d = await this.api.live();
      this.skew = d.serverTime - Date.now();
      this.d.set(d);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  label(s: string) {
    return STATUS_LABEL[s] ?? s;
  }
}
