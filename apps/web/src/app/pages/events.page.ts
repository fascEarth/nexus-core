import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { debounceTime } from 'rxjs';
import { Api, errorMessage, type OutboxRow } from '../core/api.service';
import { EventHub } from '../core/event-hub.service';

/** Event bus monitor: outbox delivery, consumers, correlation chains and dead letters. */
@Component({
  selector: 'nx-events',
  imports: [DatePipe, FormsModule, RouterLink],
  template: `
    <div class="page-head">
      <div><h1>Event monitor</h1><p class="muted">Every change is written to an outbox in the same transaction, then delivered to consumers (rules, realtime) through Redis Streams.</p></div>
      <span class="live-pill"><span class="dot" [class.on]="hub.connected()"></span> {{ hub.connected() ? 'Live' : 'Offline' }}</span>
    </div>
    @if (error()) {<p class="error">{{ error() }}</p>}

    @if (stats(); as s) {
      <div class="kpis">
        <div class="kpi card"><span class="muted small">Last hour</span><b class="kpi-value">{{ s.lastHour }}</b><span class="muted small">events written</span></div>
        <div class="kpi card"><span class="muted small">Waiting in outbox</span><b class="kpi-value">{{ s.pending }}</b><span class="muted small">{{ s.failing }} retrying</span></div>
        <div class="kpi card"><span class="muted small">Dead letters</span><b class="kpi-value" [class.error]="s.deadLetters > 0">{{ s.deadLetters }}</b><span class="muted small">failed 3 times</span></div>
        <div class="kpi card"><span class="muted small">Consumers</span><b class="kpi-value">{{ s.consumers.length }}</b><span class="muted small">{{ s.consumers.join(', ') }}</span></div>
      </div>
    }

    <div class="two-col">
      <section class="card">
        <div class="page-head pad-x"><h3>Stream</h3><input class="search" [(ngModel)]="filter" name="f" placeholder="Filter type, e.g. workflow." (keyup.enter)="load()" /></div>
        <div class="table-wrap stream">
          <table>
            <thead><tr><th>Time</th><th>Type</th><th>Record</th><th>Delivery</th></tr></thead>
            <tbody>
              @for (e of shown(); track e.id) {
                <tr [class.flash]="fresh().has(e.id)" [class.sel]="selected()?.id === e.id" (click)="selected.set(e)">
                  <td class="nowrap">{{ e.createdAt | date: 'HH:mm:ss' }}<br /><small class="muted">{{ e.createdAt | date: 'd MMM' }}</small></td>
                  <td><code>{{ e.type }}</code>@if (e.depth) {<span class="pill small">depth {{ e.depth }}</span>}</td>
                  <td>@if (e.entity) {<a class="brand-link" [routerLink]="['/app', e.entity.name, e.entity.id]" (click)="$event.stopPropagation()">{{ e.entity.name }}</a>}</td>
                  <td>@if (e.publishedAt) {<span class="pill" data-kind="ok">delivered · {{ lag(e) }}</span>} @else if (e.lastError) {<span class="pill" data-kind="bad">retry {{ e.attempts }}</span>} @else {<span class="pill">pending</span>}</td>
                </tr>
              } @empty {<tr class="static"><td colspan="4" class="muted">No events yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <aside class="side">
        <section class="card pad">
          <h3>Event details</h3>
          @if (selected(); as e) {
            <dl class="kv">
              <dt>Type</dt><dd><code>{{ e.type }}</code></dd>
              <dt>Event id</dt><dd class="mono">{{ e.id }}</dd>
              <dt>Actor</dt><dd>{{ e.actor?.type }} <span class="mono">{{ e.actor?.id?.slice(-8) }}</span></dd>
              <dt>Correlation</dt><dd class="mono">{{ e.correlationId?.slice(0, 8) }}</dd>
              <dt>Caused by</dt><dd class="mono">{{ e.causationId ? e.causationId.slice(0, 8) : '— (user action)' }}</dd>
              <dt>Written</dt><dd>{{ e.createdAt | date: 'medium' }}</dd>
              <dt>Delivered</dt><dd>{{ e.publishedAt ? (e.publishedAt | date: 'medium') : 'not yet' }}</dd>
            </dl>
            @if (chain().length > 1) {
              <h3 class="mt">Same request ({{ chain().length }} events)</h3>
              <ol class="chain">@for (c of chain(); track c.id) {<li [class.cur]="c.id === e.id"><code>{{ c.type }}</code></li>}</ol>
              <p class="muted small">One user action fans out into several events; consumers react to each, and anything they emit carries the same correlation id (depth-limited to stop loops).</p>
            }
          } @else {<p class="muted small">Select an event to see its causation chain.</p>}
        </section>

        <section class="card pad">
          <h3>Dead letters</h3>
          @for (d of dead(); track d.id) {
            <div class="dl"><code>{{ d.payload.type ?? d.eventId }}</code><small class="muted">{{ d.consumer }} · {{ d.createdAt | date: 'd MMM, HH:mm' }}</small><small class="error">{{ d.error }}</small><button class="btn" (click)="replay(d.id)">Replay</button></div>
          } @empty {<p class="muted small">None. Events that fail 3 times land here and can be replayed after a fix.</p>}
        </section>
      </aside>
    </div>
  `,
})
export class EventsPage implements OnInit {
  private api = inject(Api);
  hub = inject(EventHub);
  private destroyRef = inject(DestroyRef);
  events = signal<OutboxRow[]>([]);
  stats = signal<Awaited<ReturnType<Api['eventStats']>> | null>(null);
  dead = signal<Awaited<ReturnType<Api['deadLetters']>>>([]);
  selected = signal<OutboxRow | null>(null);
  fresh = signal(new Set<string>());
  error = signal('');
  filter = '';

  shown = computed(() => this.events());
  chain = computed(() => {
    const s = this.selected();
    if (!s?.correlationId) return [];
    return this.events().filter((e) => e.correlationId === s.correlationId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  });

  async ngOnInit() {
    await this.load();
    this.hub.events$.pipe(debounceTime(500), takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.load(true));
  }

  async load(live = false) {
    try {
      const before = new Set(this.events().map((e) => e.id));
      const [ev, st, dl] = await Promise.all([this.api.recentEvents(this.filter.trim() || undefined), this.api.eventStats(), this.api.deadLetters()]);
      this.events.set(ev);
      this.stats.set(st);
      this.dead.set(dl);
      if (live) {
        const fresh = new Set(ev.filter((e) => !before.has(e.id)).map((e) => e.id));
        this.fresh.set(fresh);
        setTimeout(() => this.fresh.set(new Set()), 1500);
      }
      this.error.set('');
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  lag(e: OutboxRow) {
    if (!e.publishedAt) return '';
    const ms = new Date(e.publishedAt).getTime() - new Date(e.createdAt).getTime();
    return ms < 1000 ? `${Math.max(ms, 1)} ms` : `${(ms / 1000).toFixed(1)} s`;
  }

  async replay(id: string) {
    try {
      await this.api.replay(id);
      await this.load();
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}
