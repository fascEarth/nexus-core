import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EventHub } from '../../core/event-hub.service';
import { errorMessage } from '../../core/api.service';
import { FoodApi, rupees } from '../food.api';
import { FoodMap, MapLine, MapMarker } from '../shared/food-map';
import { LatLng, along, roadRoute } from '../shared/geo';
import { RiderState } from './rider-shell';

@Component({
  selector: 'fx-trip',
  imports: [FoodMap],
  template: `
    <div class="fx-wrap" style="padding-top:16px">
      @if (state.home(); as h) {
        <div class="fx-kpis" style="margin-top:0">
          <div class="fx-kpi"><small>Today's earnings</small><b>{{ money(h.today.earnings) }}</b></div>
          <div class="fx-kpi"><small>Trips today</small><b>{{ h.today.trips }}</b></div>
          <div class="fx-kpi"><small>Distance</small><b>{{ h.today.km }} km</b></div>
          <div class="fx-kpi"><small>Rating</small><b>★ {{ h.profile.rating }}</b></div>
        </div>
        @if (h.active; as d) {
          <div class="fx-two">
            <fx-map class="fx-track-map" [markers]="markers()" [lines]="lines()" [fitKey]="d.id + d.status" />
            <section class="fx-card fx-trip">
              <div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">{{ d.orderNumber }}</h3><span class="fx-status">{{ d.status === 'assigned' ? 'Go to restaurant' : 'Deliver to customer' }}</span></div>
              <div class="leg"><i>🍽️</i><div><b>{{ d.restaurantName }}</b><br /><small class="fx-muted">Pickup · order is {{ orderLabel() }}</small></div></div>
              <div class="leg"><i>🏠</i><div><b>{{ d.customerName }}</b><br /><small class="fx-muted">{{ d.address }}</small></div></div>
              @if (h.order; as o) {
                <div class="fx-card" style="padding:10px;background:var(--bg)">
                  <small class="fx-muted">{{ o.itemCount }} item{{ o.itemCount === 1 ? '' : 's' }} · </small><b>{{ o.paymentMethod === 'cod' ? 'Collect cash ' + money(o.total) : 'Prepaid · no cash' }}</b>
                  <ul style="margin:6px 0 0;padding-left:18px;font-size:13px">@for (l of o.items; track l.id) { <li>{{ l.qty }} × {{ l.name }}</li> }</ul>
                </div>
              }
              <small class="fx-muted">{{ d.distanceKm }} km trip · payout {{ money(d.payout) }}</small>
              @if (error()) { <p class="error">{{ error() }}</p> }
              @if (d.status === 'assigned') {
                <button class="fx-btn green" [disabled]="busy() || h.order?.status !== 'ready'" (click)="act('pick_up')">{{ h.order?.status === 'ready' ? '✅ Picked up the order' : '⏳ Waiting for the kitchen…' }}</button>
              } @else {
                <button class="fx-btn" [disabled]="busy()" (click)="act('deliver')">🏁 Mark as delivered</button>
              }
              <small class="fx-muted">If you step away, the demo autopilot completes the trip after a couple of minutes.</small>
            </section>
          </div>
        } @else {
          <div class="fx-card fx-empty">
            @if (h.profile.online) {
              <span>📡</span><b>You're online. Looking for orders near {{ h.profile.zone }}…</b>
              <p class="fx-muted">New trips are offered to you first. Place an order from the customer app in another tab to get one right away.</p>
            } @else {
              <span>😴</span><b>You're offline</b><p class="fx-muted">Go online to start receiving delivery requests.</p>
            }
          </div>
        }
        <h2>Recent trips</h2>
        <div class="fx-card" style="overflow:auto">
          <table class="fx-table"><thead><tr><th>Trip</th><th>Restaurant</th><th>Distance</th><th>Payout</th></tr></thead>
            <tbody>@for (t of h.trips; track t.id) { <tr><td>{{ t.orderNumber }}</td><td>{{ t.restaurantName }}</td><td>{{ t.distanceKm }} km</td><td>{{ money(t.payout) }}</td></tr> } @empty { <tr><td colspan="4" class="fx-muted">No trips this week yet</td></tr> }</tbody></table>
        </div>
      } @else if (state.error()) { <div class="fx-empty"><span>⚠️</span><b>{{ state.error() }}</b></div> }
    </div>
  `,
})
export class TripPage implements OnInit {
  state = inject(RiderState);
  private api = inject(FoodApi);
  private hub = inject(EventHub);
  private destroyRef = inject(DestroyRef);
  busy = signal(false);
  error = signal('');
  now = signal(Date.now());
  private approach = signal<LatLng[]>([]);
  private drop = signal<LatLng[]>([]);
  private routed = '';
  money = rupees;

  orderLabel = computed(() => ({ accepted: 'being prepared', ready: 'ready ✓', placed: 'waiting to be accepted', picked_up: 'with you' } as Record<string, string>)[this.state.home()?.order?.status ?? ''] ?? '…');

  me = computed<LatLng | null>(() => {
    const d = this.state.home()?.active;
    if (!d) return null;
    const now = this.now() + (this.state.serverNow() - Date.now());
    if (d.status === 'picked_up') return along(this.drop().length ? this.drop() : [[d.pickupLat, d.pickupLng], [d.dropLat, d.dropLng]], (now - new Date(d.pickedUpAt ?? d.updatedAt).getTime()) / (d.travelSeconds * 1000));
    return along(this.approach().length ? this.approach() : [[d.startLat, d.startLng], [d.pickupLat, d.pickupLng]], (now - new Date(d.assignedAt).getTime()) / (d.approachSeconds * 1000));
  });

  markers = computed<MapMarker[]>(() => {
    const d = this.state.home()?.active;
    if (!d) return [];
    const m: MapMarker[] = [
      { id: 'p', at: [d.pickupLat, d.pickupLng], icon: '🍽️', kind: 'restaurant', title: d.restaurantName },
      { id: 'd', at: [d.dropLat, d.dropLng], icon: '🏠', kind: 'home', title: d.customerName },
    ];
    const me = this.me();
    if (me) m.push({ id: 'me', at: me, icon: '🛵', kind: 'rider', title: 'You' });
    return m;
  });

  lines = computed<MapLine[]>(() => {
    const d = this.state.home()?.active;
    if (!d) return [];
    return d.status === 'assigned'
      ? [{ id: 'a', points: this.approach(), color: '#0f766e' }, { id: 'b', points: this.drop(), color: '#9ca3af', dashed: true }].filter((l) => l.points.length)
      : [{ id: 'b', points: this.drop(), color: '#0f766e' }].filter((l) => l.points.length);
  });

  ngOnInit() {
    const stop = this.hub.watch('delivery');
    this.hub.events$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((e) => {
      if (e.entity?.name === 'delivery' || e.entity?.name === 'order' || e.entity?.name === 'rider_profile') void this.refresh();
    });
    const tick = setInterval(() => this.now.set(Date.now()), 1000);
    const poll = setInterval(() => void this.refresh(), 6000);
    this.destroyRef.onDestroy(() => { stop(); clearInterval(tick); clearInterval(poll); });
    void this.refresh();
  }

  private async refresh() {
    await this.state.load();
    const d = this.state.home()?.active;
    if (d && d.id !== this.routed) {
      this.routed = d.id;
      void roadRoute([d.startLat, d.startLng], [d.pickupLat, d.pickupLng]).then((p) => this.approach.set(p));
      void roadRoute([d.pickupLat, d.pickupLng], [d.dropLat, d.dropLng]).then((p) => this.drop.set(p));
    }
  }

  async act(action: 'pick_up' | 'deliver') {
    const d = this.state.home()?.active;
    if (!d) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.riderAction(d.id, action);
      await this.refresh();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
