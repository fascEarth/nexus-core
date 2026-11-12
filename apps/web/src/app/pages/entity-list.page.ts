import { Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { EntityDefinition } from '@nexus/shared-types';
import { Api, errorMessage, RecordRow } from '../core/api.service';
import { EventHub } from '../core/event-hub.service';
import { CanDirective } from '../core/can.directive';

/** Grid for ANY metadata entity. Rows update live via socket patches. */
@Component({
  selector: 'nx-entity-list',
  imports: [RouterLink, FormsModule, CanDirective],
  template: `
    @if (def(); as d) {
      <div class="page-head">
        <h1>{{ d.pluralLabel }}</h1>
        <div class="actions">
          <input class="search" placeholder="Search…" [(ngModel)]="search" (keyup.enter)="load()" />
          <a class="btn primary" *nxCan="d.name + ':create'" [routerLink]="['/app', d.name, 'new']">New {{ d.label }}</a>
        </div>
      </div>
      @if (error()) { <p class="error">{{ error() }}</p> }
      <div class="card table-wrap">
        <table>
          <thead><tr><th>#</th>@for (f of columns(); track f.name) {<th>{{ f.label }}</th>}<th>Status</th></tr></thead>
          <tbody>
            @for (r of rows(); track r.id) {
              <tr [routerLink]="['/app', d.name, r.id]" [class.flash]="flashed() === r.id">
                <td>{{ r.number ?? '—' }}</td>
                @for (f of columns(); track f.name) {<td>{{ r.data[f.name] ?? '' }}</td>}
                <td>@if (r.status) {<span class="pill">{{ r.status }}</span>}</td>
              </tr>
            } @empty { <tr><td [attr.colspan]="columns().length + 2" class="muted pad">No records yet</td></tr> }
          </tbody>
        </table>
      </div>
      <p class="muted">{{ total() }} total</p>
    }
  `,
})
export class EntityListPage {
  readonly entity = input.required<string>();
  private api = inject(Api);
  private hub = inject(EventHub);
  private destroyRef = inject(DestroyRef);

  def = signal<EntityDefinition | null>(null);
  columns = signal<EntityDefinition['fields']>([]);
  rows = signal<RecordRow[]>([]);
  total = signal(0);
  error = signal('');
  flashed = signal<string | null>(null);
  search = '';
  private unwatch?: () => void;

  constructor() {
    effect(() => void this.init(this.entity()));
    this.destroyRef.onDestroy(() => this.unwatch?.());

    this.hub.patches$.pipe(takeUntilDestroyed()).subscribe((p) => {
      if (p.entity !== this.entity()) return;
      if (p.op === 'delete') {
        this.rows.update((rows) => rows.filter((r) => r.id !== p.id));
        return;
      }
      const exists = this.rows().some((r) => r.id === p.id);
      if (!exists) {
        void this.load();
      } else {
        this.rows.update((rows) =>
          rows.map((r) => (r.id === p.id ? { ...r, status: (p.data?.['status'] as string) ?? r.status, data: { ...r.data, ...p.data } } : r)),
        );
      }
      this.flashed.set(p.id);
      setTimeout(() => this.flashed.set(null), 1200);
    });
  }

  private async init(entity: string) {
    this.unwatch?.();
    this.unwatch = this.hub.watch(entity);
    try {
      const def = await this.api.entity(entity);
      this.def.set(def);
      this.columns.set(def.fields.filter((f) => !['textarea', 'json', 'file'].includes(f.type)).slice(0, 5));
      await this.load();
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  async load() {
    try {
      const page = await this.api.list(this.entity(), { search: this.search, pageSize: 50 });
      this.rows.set(page.items);
      this.total.set(page.total);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}
