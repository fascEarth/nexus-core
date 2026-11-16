import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { BarChart, Donut, LineChart } from '../../shared/charts';
import { errorMessage } from '../../core/api.service';
import { FoodApi, FoodInsights, STATUS_LABEL, rupees } from '../food.api';

@Component({
  selector: 'fx-food-insights',
  imports: [LineChart, BarChart, Donut],
  template: `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <h1 style="margin:0">Business insights</h1>
      <span style="display:flex;gap:6px">@for (n of [7, 30, 90]; track n) { <button class="btn" [class.primary]="days() === n" (click)="load(n)">{{ n }} days</button> }</span>
    </div>
    @if (error()) { <p class="error">{{ error() }}</p> }
    @if (d(); as d) {
      <div class="fx-kpis">
        <div class="fx-kpi"><small>GMV</small><b>{{ money(d.totals.gmv) }}</b></div>
        <div class="fx-kpi"><small>Orders</small><b>{{ d.totals.orders }}</b></div>
        <div class="fx-kpi"><small>Average order value</small><b>{{ money(d.totals.aov) }}</b></div>
        <div class="fx-kpi"><small>Avg delivery time</small><b>{{ d.totals.avgDeliveryMinutes }} min</b></div>
        <div class="fx-kpi"><small>Cancel + decline rate</small><b>{{ d.totals.cancelRate }}%</b></div>
        <div class="fx-kpi"><small>Repeat customers</small><b>{{ d.totals.repeatCustomers }}/{{ d.totals.customers }}</b></div>
        <div class="fx-kpi"><small>Discounts given</small><b>{{ money(d.totals.discounts) }}</b></div>
      </div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(380px,1fr))">
        <section class="card pad"><h3>Orders &amp; GMV per day</h3><nx-line-chart [labels]="labels()" [series]="[{ name: 'Orders', values: d.orders, color: '#f2542d' }]" /><nx-line-chart [labels]="labels()" [height]="150" [series]="[{ name: 'GMV ₹', values: d.gmv, color: '#0f766e' }]" /></section>
        <section class="card pad"><h3>Orders by hour of day (IST)</h3><nx-bar-chart color="#f2542d" [data]="hours()" /><small class="muted">Lunch and dinner peaks drive rider staffing.</small></section>
        <section class="card pad"><h3>Order outcomes</h3><nx-donut [data]="status()" centerLabel="orders" /></section>
        <section class="card pad"><h3>Payment mix</h3><nx-donut [data]="payments()" centerLabel="orders" /></section>
        <section class="card pad"><h3>Average delivery minutes</h3><nx-line-chart [labels]="labels()" [series]="[{ name: 'Minutes', values: d.deliveryMinutes, color: '#7c3aed' }]" [area]="false" /></section>
        <section class="card pad">
          <h3>Coupons</h3>
          <table class="fx-table"><thead><tr><th>Code</th><th>Uses</th><th>Discount</th></tr></thead>
            <tbody>@for (c of d.coupons; track c.code) { <tr><td><code>{{ c.code }}</code></td><td>{{ c.uses }}</td><td>{{ money(c.discount) }}</td></tr> }</tbody></table>
        </section>
        <section class="card pad">
          <h3>Restaurants</h3>
          <table class="fx-table"><thead><tr><th>Restaurant</th><th>Orders</th><th>GMV</th><th>Rating</th><th>Declined</th></tr></thead>
            <tbody>@for (r of d.restaurants; track r.name) { <tr><td>{{ r.name }}</td><td>{{ r.orders }}</td><td>{{ money(r.gmv) }}</td><td>{{ r.rating ?? '–' }}</td><td>{{ r.declineRate }}%</td></tr> }</tbody></table>
        </section>
        <section class="card pad">
          <h3>Top dishes</h3>
          <table class="fx-table"><thead><tr><th>Dish</th><th>Restaurant</th><th>Sold</th></tr></thead>
            <tbody>@for (x of d.dishes; track x.name + x.restaurant) { <tr><td>{{ x.name }}</td><td>{{ x.restaurant }}</td><td>{{ x.qty }}</td></tr> }</tbody></table>
        </section>
      </div>
    } @else if (!error()) { <p class="muted">Loading…</p> }
  `,
})
export class FoodInsightsPage implements OnInit {
  private api = inject(FoodApi);
  d = signal<FoodInsights | null>(null);
  days = signal(30);
  error = signal('');
  money = rupees;
  labels = computed(() => (this.d()?.days ?? []).map((x) => x.slice(5)));
  hours = computed(() => (this.d()?.hours ?? []).map((v, h) => ({ label: String(h), value: v })).slice(6));
  status = computed(() => (this.d()?.status ?? []).map((s) => ({ label: STATUS_LABEL[s.status] ?? s.status, value: s.count })));
  payments = computed(() => (this.d()?.payments ?? []).map((p) => ({ label: p.method.toUpperCase(), value: p.count })));

  ngOnInit() {
    void this.load(30);
  }

  async load(n: number) {
    this.days.set(n);
    try {
      this.d.set(await this.api.insights(n));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}
