import { Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { rupees } from '../food.api';
import { BarChart } from '../../shared/charts';
import { RiderState } from './rider-shell';

@Component({
  selector: 'fx-earnings',
  imports: [BarChart, DatePipe],
  template: `
    <div class="fx-wrap" style="padding-top:16px">
      <h1>Earnings</h1>
      @if (state.home(); as h) {
        <div class="fx-kpis">
          <div class="fx-kpi"><small>This week</small><b>{{ money(week()) }}</b></div>
          <div class="fx-kpi"><small>Trips this week</small><b>{{ h.week.trips }}</b></div>
          <div class="fx-kpi"><small>Today</small><b>{{ money(h.today.earnings) }}</b></div>
          <div class="fx-kpi"><small>Avg per trip</small><b>{{ money(h.week.trips ? week() / h.week.trips : 0) }}</b></div>
        </div>
        <section class="fx-card"><h3>Last 7 days</h3><nx-bar-chart color="#0f766e" [data]="bars()" /></section>
        <h2>Payout breakdown</h2>
        <div class="fx-card" style="overflow:auto">
          <table class="fx-table"><thead><tr><th>Delivered</th><th>Order</th><th>Distance</th><th>Base + distance</th></tr></thead>
            <tbody>@for (t of h.trips; track t.id) { <tr><td>{{ t.deliveredAt | date: 'd MMM, h:mm a' }}</td><td>{{ t.orderNumber }}</td><td>{{ t.distanceKm }} km</td><td>{{ money(t.payout) }}</td></tr> }</tbody></table>
        </div>
        <p class="fx-muted">Payout = ₹30 base + ₹7 per km. Settled weekly (simulated).</p>
      }
    </div>
  `,
})
export class EarningsPage {
  state = inject(RiderState);
  money = rupees;
  week = computed(() => (this.state.home()?.week.earnings ?? []).reduce((s, x) => s + x, 0));
  bars = computed(() => {
    const w = this.state.home()?.week;
    return (w?.days ?? []).map((d, i) => ({ label: new Date(d).toLocaleDateString('en-IN', { weekday: 'short' }), value: w!.earnings[i], title: `${d}: ₹${w!.earnings[i]}` }));
  });
}
