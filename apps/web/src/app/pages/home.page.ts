import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { debounceTime } from 'rxjs';
import { Api, errorMessage, type Overview } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { EventHub } from '../core/event-hub.service';
import { BarChart, Donut, Kpi, LineChart, Sparkline } from '../shared/charts';

const STATE_LABEL: Record<string, string> = { draft: 'Draft', submitted: 'Manager review', hr_review: 'HR review', finance_review: 'Finance review', approved: 'Approved', paid: 'Paid', rejected: 'Rejected' };

/** Dashboard: KPIs, trends and activity. Refreshes live when anything happens anywhere in the app. */
@Component({
  selector: 'nx-home',
  imports: [RouterLink, DatePipe, BarChart, LineChart, Donut, Kpi, Sparkline],
  template: `
    <div class="page-head">
      <div><h1>{{ greeting() }}, {{ firstName() }}</h1><p class="muted">Here's what is happening in {{ auth.tokens()?.tenant?.name }}.</p></div>
    </div>
    @if (error()) {<p class="error">{{ error() }}</p>}
    @if (o(); as o) {
      <div class="kpis">
        <a class="kpi-link" routerLink="/app/ops"><nx-kpi label="Live operations" value="Open" hint="Orders, riders and kitchens on a map" /></a>
        @for (e of o.entities; track e.name) {
          <a class="kpi-link" [routerLink]="['/app', e.name]">
            <div class="kpi card"><span class="muted small">{{ e.label }}</span><b class="kpi-value">{{ e.total }}</b><nx-sparkline [values]="e.daily" /><span class="muted small">{{ sum(e.daily) }} in the last 14 days</span></div>
          </a>
        }
        @if (o.events) {<nx-kpi label="Events (24h)" [value]="o.events.total24h" [hint]="o.events.pending + ' pending · ' + o.events.deadLetters + ' dead letters'" />}
        @if (o.users) {<nx-kpi label="Active users" [value]="o.users.active" [hint]="o.users.total + ' members'" />}
      </div>

      <div class="grid-2">
        <section class="card pad">
          <div class="page-head"><h3>Records created</h3><span class="muted small">last 14 days</span></div>
          <nx-line-chart [labels]="dayLabels()" [series]="trend()" [area]="false" ariaLabel="Records created per day" />
        </section>
        @if (o.events) {
          <section class="card pad">
            <div class="page-head"><h3>Event throughput</h3><a class="small brand-link" routerLink="/app/events">Open monitor →</a></div>
            <nx-bar-chart [data]="eventBars()" ariaLabel="Events per hour" />
          </section>
        } @else {
          <section class="card pad">
            <h3>By status</h3>
            <nx-donut [data]="statusMix()" centerLabel="records" />
          </section>
        }
      </div>

      <div class="grid-3">
        @if (o.workflow) {
          <section class="card pad"><h3>Approvals pipeline</h3><nx-donut [data]="pipeline()" centerLabel="requests" /></section>
        }
        <section class="card pad" [class.span-2]="!o.workflow">
          <div class="page-head"><h3>{{ o.events ? 'Recent activity' : 'Your recent activity' }}</h3>@if (o.events) {<a class="small brand-link" routerLink="/app/activity">Audit log →</a>}</div>
          <ul class="feed">
            @for (a of o.activity; track a.id) {
              <li>
                <span class="avatar">{{ initials(a.actor) }}</span>
                <span class="grow"><span><b>{{ a.actor }}</b> {{ verb(a.action) }} @if (a.entity === 'user') {<a routerLink="/app/people">{{ a.number ?? 'a member' }}</a>} @else {<a [routerLink]="['/app', a.entity, a.entityId]">{{ a.number ?? a.entity }}</a>}</span><small class="muted">{{ a.createdAt | date: 'd MMM, h:mm a' }}</small></span>
              </li>
            } @empty {<li class="muted">No activity yet.</li>}
          </ul>
        </section>
        @if (o.events; as ev) {
          <section class="card pad">
            <h3>Automation</h3>
            <div class="mini-stats">
              <div><b>{{ o.rules?.runs24h ?? 0 }}</b><span class="muted small">rule checks (24h)</span></div>
              <div><b>{{ o.rules?.matched24h ?? 0 }}</b><span class="muted small">rules fired</span></div>
              <div><b [class.error]="(o.rules?.errors24h ?? 0) > 0">{{ o.rules?.errors24h ?? 0 }}</b><span class="muted small">errors</span></div>
            </div>
            <h3 class="mt">Top events (24h)</h3>
            @for (t of ev.byType; track t.type) {<div class="type-row"><code>{{ t.type }}</code><b>{{ t.count }}</b></div>} @empty {<p class="muted small">No events in the last 24 hours.</p>}
          </section>
        }
      </div>

      <h2>Live</h2>
      <div class="card live">
        @for (e of hub.recent(); track $index) {
          <div class="row"><code>{{ e.type }}</code><small class="muted">{{ e.at | date: 'mediumTime' }}</small></div>
        } @empty { <p class="muted pad">Waiting for activity… open another tab, sign in as a different user and create or approve something to watch it arrive here.</p> }
      </div>
    } @else if (!error()) {
      <div class="kpis">@for (i of [1, 2, 3, 4]; track i) {<div class="card kpi skeleton"></div>}</div>
    }
  `,
})
export class HomePage implements OnInit {
  auth = inject(AuthService);
  hub = inject(EventHub);
  private api = inject(Api);
  private destroyRef = inject(DestroyRef);
  o = signal<Overview | null>(null);
  error = signal('');

  firstName = computed(() => (this.auth.me()?.name ?? '').split(' ')[0]);
  greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
  dayLabels = computed(() => (this.o()?.days ?? []).map((d) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })));
  trend = computed(() => (this.o()?.entities ?? []).map((e) => ({ name: e.label, values: e.daily })));
  eventBars = computed(() => (this.o()?.events?.hourly ?? []).map((h) => ({ label: new Date(h.hour).toLocaleTimeString(undefined, { hour: 'numeric' }), value: h.count })));
  pipeline = computed(() => (this.o()?.workflow ?? []).map((w) => ({ label: STATE_LABEL[w.state] ?? w.state, value: w.count })));
  statusMix = computed(() => {
    const m = new Map<string, number>();
    for (const e of this.o()?.entities ?? []) for (const s of e.byStatus) m.set(s.status, (m.get(s.status) ?? 0) + s.count);
    return [...m].map(([k, v]) => ({ label: STATE_LABEL[k] ?? k, value: v }));
  });

  async ngOnInit() {
    await this.load();
    this.hub.events$.pipe(debounceTime(600), takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.load());
  }

  private async load() {
    try {
      this.o.set(await this.api.overview());
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  sum(v: number[]) {
    return v.reduce((s, x) => s + x, 0);
  }

  initials(name: string) {
    return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  }

  verb(action: string) {
    if (action === 'create') return 'created';
    if (action === 'update') return 'updated';
    if (action === 'delete') return 'deleted';
    if (action.startsWith('workflow.')) return ({ submit: 'submitted', approve: 'approved', reject: 'rejected', escalate: 'escalated', hr_approve: 'HR-approved', finance_approve: 'finance-approved', mark_paid: 'paid', send_back: 'sent back' } as Record<string, string>)[action.slice(9)] ?? action.slice(9);
    if (action === 'user.roles_changed') return 'changed the roles of';
    if (action === 'user.suspended') return 'suspended';
    if (action === 'user.active') return 'reactivated';
    return action;
  }
}
