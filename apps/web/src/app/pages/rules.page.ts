import { Component, inject, OnInit, signal } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Api, errorMessage } from '../core/api.service';
import { CanDirective } from '../core/can.directive';

const TEMPLATE = {
  name: 'Cash order above ₹800',
  eventType: 'record.order.created',
  condition: { all: [{ fact: 'after.paymentMethod', operator: 'equal', value: 'cod' }, { fact: 'after.total', operator: 'greaterThan', value: 800 }] },
  actions: [{ action: 'notify', to: ['role:ops'], title: 'Large COD order {{after.number}}', body: '₹{{after.total}} from {{after.restaurantName}}' }],
};

const SAMPLE_EVENT = {
  id: 'evt_test', type: 'record.order.created', tenantId: 't', version: 1, depth: 0, correlationId: 'c',
  actor: { type: 'user', id: 'u1' }, occurredAt: new Date().toISOString(),
  data: { before: null, after: { id: 'r1', number: 'NE-00042', total: 960, paymentMethod: 'cod', restaurantName: 'Kovai Biryani House' } },
};

/** No-code automation: When (event) → If (condition) → Then (actions). JSON editor + dry-run. */
@Component({
  selector: 'nx-rules',
  imports: [FormsModule, JsonPipe, CanDirective],
  template: `
    <div class="page-head"><h1>Automation rules</h1></div>
    <div class="two-col">
      <div class="card table-wrap">
        <table>
          <thead><tr><th>Name</th><th>When</th><th>Active</th></tr></thead>
          <tbody>
            @for (r of rules(); track r.id) {
              <tr (click)="edit(r)"><td>{{ r.name }}</td><td><code>{{ r.eventType }}</code></td><td>{{ r.active ? 'Yes' : 'No' }}</td></tr>
            } @empty { <tr><td colspan="3" class="muted pad">No rules yet</td></tr> }
          </tbody>
        </table>
      </div>
      <div class="card pad">
        <h3>{{ editingId ? 'Edit rule' : 'New rule' }}</h3>
        <textarea class="code" rows="16" [(ngModel)]="json" name="json"></textarea>
        <div class="actions">
          <button class="btn" (click)="test()">Test with sample event</button>
          <button class="btn primary" *nxCan="'rules:create'" (click)="save()">Save</button>
          <button class="btn ghost" (click)="reset()">New</button>
        </div>
        @if (error()) {<p class="error">{{ error() }}</p>}
        @if (result()) {<pre>{{ result() | json }}</pre>}
      </div>
    </div>
  `,
})
export class RulesPage implements OnInit {
  private api = inject(Api);
  rules = signal<Awaited<ReturnType<Api['rules']>>>([]);
  error = signal('');
  result = signal<unknown>(null);
  json = JSON.stringify(TEMPLATE, null, 2);
  editingId?: string;

  async ngOnInit() {
    this.rules.set(await this.api.rules());
  }

  edit(r: { id: string; name: string; eventType: string; condition: unknown; actions: unknown; active: boolean }) {
    this.editingId = r.id;
    this.json = JSON.stringify({ name: r.name, eventType: r.eventType, condition: r.condition, actions: r.actions, active: r.active }, null, 2);
  }

  reset() {
    this.editingId = undefined;
    this.json = JSON.stringify(TEMPLATE, null, 2);
  }

  async test() {
    this.error.set('');
    try {
      this.result.set(await this.api.testRule(JSON.parse(this.json), SAMPLE_EVENT));
    } catch (e) {
      this.error.set(e instanceof SyntaxError ? 'Invalid JSON' : errorMessage(e));
    }
  }

  async save() {
    this.error.set('');
    try {
      await this.api.saveRule(JSON.parse(this.json), this.editingId);
      this.rules.set(await this.api.rules());
      this.result.set({ saved: true });
    } catch (e) {
      this.error.set(e instanceof SyntaxError ? 'Invalid JSON' : errorMessage(e));
    }
  }
}
