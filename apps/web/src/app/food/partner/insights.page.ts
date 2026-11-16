import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FoodApi, PartnerInsights, rupees } from '../food.api';
import { BarChart, LineChart } from '../../shared/charts';
import { PartnerContext } from './partner-shell';

@Component({
  selector: 'fx-partner-insights',
  imports: [BarChart, LineChart, DatePipe],
  template: `
    <div class="fx-wrap" style="padding-top:16px">
      <h1>Insights · last 14 days</h1>
      @if (d(); as d) {
        <div class="fx-kpis">
          <div class="fx-kpi"><small>Orders</small><b>{{ d.totals.orders }}</b></div>
          <div class="fx-kpi"><small>Food sales</small><b>{{ money(d.totals.sales) }}</b></div>
          <div class="fx-kpi"><small>Average order</small><b>{{ money(d.totals.avgOrder) }}</b></div>
          <div class="fx-kpi"><small>Rating</small><b>★ {{ d.restaurant.rating }}</b><small>{{ d.restaurant.ratingCount }} ratings</small></div>
          <div class="fx-kpi"><small>Declined</small><b>{{ d.totals.declineRate }}%</b></div>
        </div>
        <div class="fx-two" style="grid-template-columns:1fr 1fr">
          <section class="fx-card"><h3>Daily food sales</h3><nx-line-chart [labels]="labels()" [series]="[{ name: 'Sales', values: d.sales, color: '#f2542d' }]" /></section>
          <section class="fx-card"><h3>Orders by hour (IST)</h3><nx-bar-chart color="#f2542d" [data]="hours()" /></section>
          <section class="fx-card">
            <h3>Best-selling dishes</h3>
            <table class="fx-table"><thead><tr><th>Dish</th><th>Sold</th><th>Revenue</th></tr></thead>
              <tbody>@for (x of d.topDishes; track x.name) { <tr><td>{{ x.name }}</td><td>{{ x.qty }}</td><td>{{ money(x.revenue) }}</td></tr> }</tbody></table>
          </section>
          <section class="fx-card">
            <h3>Ratings &amp; reviews</h3>
            @for (r of d.ratings; track r.stars) {
              <div class="fx-switch-row" style="margin:4px 0"><span style="width:28px">{{ r.stars }}★</span><div style="flex:1;height:8px;background:var(--line);border-radius:4px"><div [style.width.%]="pct(r.count)" style="height:8px;border-radius:4px;background:var(--star, #1a9e55)"></div></div><small class="fx-muted" style="width:30px">{{ r.count }}</small></div>
            }
            @for (r of d.reviews; track r.number) { <p style="margin:10px 0 0;font-size:13px"><span class="fx-star">★ {{ r.rating }}</span> “{{ r.review }}” <small class="fx-muted">— {{ r.customer }}, {{ r.at | date: 'd MMM' }}</small></p> }
          </section>
        </div>
      } @else { <p class="fx-muted">Loading…</p> }
    </div>
  `,
})
export class PartnerInsightsPage {
  private api = inject(FoodApi);
  private ctx = inject(PartnerContext);
  d = signal<PartnerInsights | null>(null);
  labels = computed(() => (this.d()?.days ?? []).map((x) => x.slice(8)));
  hours = computed(() => (this.d()?.hours ?? []).map((v, h) => ({ label: String(h), value: v })).slice(7));
  money = rupees;

  constructor() {
    effect(() => {
      const id = this.ctx.restaurantId();
      untracked(() => void this.api.partnerInsights(id).then((d) => { this.d.set(d); this.ctx.restaurant.set(d.restaurant); }));
    });
  }

  pct(n: number) {
    const total = (this.d()?.ratings ?? []).reduce((s, r) => s + r.count, 0);
    return total ? (n / total) * 100 : 0;
  }
}
