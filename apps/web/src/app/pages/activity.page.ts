import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, type AuditRow, errorMessage } from '../core/api.service';

/** Append-only audit trail: who changed what, when, with field-level diffs. */
@Component({
  selector: 'nx-activity',
  imports: [DatePipe, FormsModule, RouterLink],
  template: `
    <div class="page-head">
      <div><h1>Activity &amp; audit log</h1><p class="muted">Every change is recorded in the same transaction as the data and can't be edited.</p></div>
    </div>
    <div class="card filters">
      <select [(ngModel)]="entity" name="e" (change)="load(1)" aria-label="Entity"><option value="">All records</option>@for (e of entities(); track e) {<option [value]="e">{{ e }}</option>}</select>
      <input [(ngModel)]="action" name="a" placeholder="Action, e.g. approve" (keyup.enter)="load(1)" />
      <input [(ngModel)]="entityId" name="id" placeholder="Record id" (keyup.enter)="load(1)" />
      <button class="btn primary" (click)="load(1)">Filter</button>
      @if (entity || action || entityId) {<button class="btn ghost" (click)="entity = ''; action = ''; entityId = ''; load(1)">Clear</button>}
    </div>
    @if (error()) {<p class="error">{{ error() }}</p>}
    <div class="card table-wrap">
      <table>
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Changes</th></tr></thead>
        <tbody>
          @for (r of rows(); track r.id) {
            <tr class="static">
              <td class="nowrap">{{ r.createdAt | date: 'd MMM, HH:mm:ss' }}</td>
              <td><b>{{ r.actor }}</b><br /><small class="muted">{{ r.actorType }}</small></td>
              <td><span class="pill" [attr.data-kind]="kind(r.action)">{{ r.action }}</span></td>
              <td>
                @if (r.entity !== 'user') {<a class="brand-link" [routerLink]="['/app', r.entity, r.entityId]">{{ r.entity }}</a>} @else {<a class="brand-link" routerLink="/app/people">{{ r.subject ?? 'user' }}</a>}
                <br /><button class="link small mono" (click)="entityId = r.entityId; load(1)" title="Show this record's history">{{ r.entityId.slice(-8) }}</button>
              </td>
              <td>
                @for (c of r.changes; track c.field) {
                  <div class="change"><span class="muted">{{ c.field }}</span> <s>{{ show(c.from) }}</s> → <b>{{ show(c.to) }}</b></div>
                } @empty {<span class="muted small">—</span>}
              </td>
            </tr>
          } @empty {<tr class="static"><td colspan="5" class="muted">No entries.</td></tr>}
        </tbody>
      </table>
    </div>
    <div class="pager">
      <span class="muted small">{{ total() }} entries · page {{ page() }} of {{ pages() }}</span>
      <button class="btn" [disabled]="page() <= 1" (click)="load(page() - 1)">‹ Prev</button>
      <button class="btn" [disabled]="page() >= pages()" (click)="load(page() + 1)">Next ›</button>
    </div>
  `,
})
export class ActivityPage implements OnInit {
  private api = inject(Api);
  rows = signal<AuditRow[]>([]);
  entities = signal<string[]>([]);
  total = signal(0);
  page = signal(1);
  error = signal('');
  pages = computed(() => Math.max(1, Math.ceil(this.total() / 30)));
  entity = '';
  action = '';
  entityId = '';

  ngOnInit() {
    void this.load(1);
  }

  async load(page: number) {
    try {
      const r = await this.api.audit({ entity: this.entity, action: this.action, entityId: this.entityId.trim(), page });
      this.rows.set(r.items);
      this.total.set(r.total);
      this.page.set(r.page);
      if (r.entities?.length) this.entities.set(r.entities);
      this.error.set('');
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  kind(action: string) {
    if (action.includes('reject') || action.includes('delete') || action.includes('suspend')) return 'bad';
    if (action.includes('approve') || action.includes('paid') || action === 'create') return 'ok';
    return 'info';
  }

  show(v: unknown) {
    if (v === null || v === undefined || v === '') return '∅';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }
}
