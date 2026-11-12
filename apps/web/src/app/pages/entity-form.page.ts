import { Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { EntityDefinition, FieldDefinition } from '@nexus/shared-types';
import { Api, errorMessage, RecordRow, WorkflowInfo } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { EventHub } from '../core/event-hub.service';

/** Dynamic form for ANY entity + its workflow actions + audit history. */
@Component({
  selector: 'nx-entity-form',
  imports: [FormsModule, RouterLink, DatePipe, JsonPipe],
  template: `
    @if (def(); as d) {
      <div class="page-head">
        <h1>{{ isNew() ? 'New ' + d.label : (record()?.number ?? d.label) }}</h1>
        <a class="btn ghost" [routerLink]="['/app', d.name]">Back</a>
      </div>
      @if (stale()) {
        <div class="banner">This record was just changed elsewhere. <button class="btn ghost" (click)="reload()">Load latest</button></div>
      }
      <div class="two-col">
        <form class="card form" (ngSubmit)="save()">
          @for (f of d.fields; track f.name) {
            <label [class.wide]="f.type === 'textarea'">
              {{ f.label }} @if (f.required) {<span class="req">*</span>}
              @switch (f.type) {
                @case ('textarea') { <textarea [name]="f.name" [(ngModel)]="model[f.name]" [disabled]="readOnly(f)" rows="3"></textarea> }
                @case ('select') {
                  <select [name]="f.name" [(ngModel)]="model[f.name]" [disabled]="readOnly(f)">
                    <option [ngValue]="null">—</option>
                    @for (o of f.options ?? []; track o) {<option [ngValue]="o">{{ o }}</option>}
                  </select>
                }
                @case ('boolean') { <input type="checkbox" [name]="f.name" [(ngModel)]="model[f.name]" [disabled]="readOnly(f)" /> }
                @default { <input [type]="inputType(f)" [name]="f.name" [(ngModel)]="model[f.name]" [disabled]="readOnly(f)" /> }
              }
            </label>
          }
          @if (error()) { <p class="error wide" role="alert">{{ error() }}</p> }
          @if (editable()) {
            <div class="wide"><button class="btn primary" type="submit" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save' }}</button></div>
          }
        </form>

        @if (!isNew()) {
          <aside class="side">
            @if (workflow(); as wf) {
              <div class="card pad">
                <h3>Status: <span class="pill">{{ wf.stateLabel ?? wf.state }}</span></h3>
                @if (wf.transitions.length) {
                  <textarea placeholder="Comment (required for some actions)" [(ngModel)]="comment" name="comment" rows="2"></textarea>
                  <div class="actions">
                    @for (t of wf.transitions; track t.name) {
                      <button class="btn" (click)="fire(t.name)" [disabled]="busy()">{{ t.label }}</button>
                    }
                  </div>
                }
                <ol class="timeline">
                  @for (h of wf.history; track $index) {
                    <li><b>{{ h.transition }}</b> {{ h.fromState }} → {{ h.toState }}
                      @if (h.comment) {<div class="muted">“{{ h.comment }}”</div>}
                      <small class="muted">{{ h.createdAt | date: 'short' }}</small></li>
                  }
                </ol>
              </div>
            }
            <div class="card pad">
              <h3>History</h3>
              @for (h of history(); track $index) {
                <details><summary>{{ h.action }} · {{ h.actorType }} · {{ h.createdAt | date: 'short' }}</summary><pre>{{ h.after | json }}</pre></details>
              }
            </div>
          </aside>
        }
      </div>
    }
  `,
})
export class EntityFormPage {
  readonly entity = input.required<string>();
  readonly id = input.required<string>();
  private api = inject(Api);
  private auth = inject(AuthService);
  private hub = inject(EventHub);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  def = signal<EntityDefinition | null>(null);
  record = signal<RecordRow | null>(null);
  workflow = signal<WorkflowInfo | null>(null);
  history = signal<Awaited<ReturnType<Api['history']>>>([]);
  error = signal('');
  busy = signal(false);
  stale = signal(false);
  model: Record<string, unknown> = {};
  comment = '';
  private unwatch?: () => void;

  constructor() {
    effect(() => void this.init(this.entity(), this.id()));
    this.destroyRef.onDestroy(() => this.unwatch?.());
    this.hub.patches$.pipe(takeUntilDestroyed()).subscribe((p) => {
      if (p.entity === this.entity() && p.id === this.id() && !this.busy()) this.stale.set(true);
    });
  }

  isNew = () => this.id() === 'new';
  editable = () => this.isNew() || (this.auth.can(this.entity(), 'update') && !this.workflow()?.final);
  readOnly = (f: FieldDefinition) => !this.editable() || (f as FieldDefinition & { readOnly?: boolean }).readOnly === true;
  inputType = (f: FieldDefinition) =>
    ({ number: 'number', money: 'number', date: 'date', datetime: 'datetime-local', email: 'email', phone: 'tel' } as Record<string, string>)[f.type] ?? 'text';

  private async init(entity: string, id: string) {
    this.unwatch?.();
    this.unwatch = this.hub.watch(entity);
    this.def.set(await this.api.entity(entity));
    if (id === 'new') {
      this.model = Object.fromEntries(this.def()!.fields.map((f) => [f.name, f.defaultValue ?? null]));
      return;
    }
    await this.reload();
  }

  async reload() {
    this.stale.set(false);
    const [record, history] = await Promise.all([this.api.get(this.entity(), this.id()), this.api.history(this.entity(), this.id())]);
    this.record.set(record);
    this.history.set(history);
    this.model = { ...record.data };
    this.workflow.set(await this.api.workflow(this.entity(), this.id()).catch(() => null));
  }

  async save() {
    this.busy.set(true);
    this.error.set('');
    try {
      const data = Object.fromEntries(Object.entries(this.model).filter(([, v]) => v !== null && v !== ''));
      if (this.isNew()) {
        const created = await this.api.create(this.entity(), data);
        await this.router.navigate(['/app', this.entity(), created.id]);
      } else {
        await this.api.update(this.entity(), this.id(), data, this.record()!.version);
        await this.reload();
      }
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  async fire(transition: string) {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.transition(this.entity(), this.id(), transition, this.comment || undefined);
      this.comment = '';
      await this.reload();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
