import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { debounceTime } from 'rxjs';
import { Api } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { EventHub } from '../core/event-hub.service';

/** Dashboard: counters update live when anything happens anywhere in the app. */
@Component({
  selector: 'nx-home',
  imports: [RouterLink, DatePipe],
  template: `
    <h1>Welcome, {{ auth.me()?.name }}</h1>
    <div class="grid stats">
      @for (s of stats(); track s.name) {
        <a class="card stat" [routerLink]="['/app', s.name]">
          <span class="muted">{{ s.label }}</span><b>{{ s.total }}</b>
        </a>
      }
      <a class="card stat" routerLink="/app/inbox"><span class="muted">Pending approvals</span><b>{{ pending() }}</b></a>
    </div>
    <h2>Live activity</h2>
    <div class="card">
      @for (e of hub.recent(); track $index) {
        <div class="row"><code>{{ e.type }}</code><small class="muted">{{ e.at | date: 'mediumTime' }}</small></div>
      } @empty { <p class="muted pad">Waiting for activity… open another tab and create a record to see it here.</p> }
    </div>
  `,
})
export class HomePage implements OnInit {
  auth = inject(AuthService);
  hub = inject(EventHub);
  private api = inject(Api);
  private destroyRef = inject(DestroyRef);
  stats = signal<{ name: string; label: string; total: number }[]>([]);
  pending = signal(0);

  async ngOnInit() {
    await this.load();
    this.hub.events$.pipe(debounceTime(400), takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.load());
  }

  private async load() {
    const entities = this.api.entities().length ? this.api.entities() : await this.api.loadEntities();
    const totals = await Promise.all(entities.map((e) => this.api.list(e.name, { pageSize: 1 }).then((p) => p.total).catch(() => 0)));
    this.stats.set(entities.map((e, i) => ({ name: e.name, label: e.pluralLabel, total: totals[i] })));
    this.pending.set((await this.api.inbox()).length);
  }
}
