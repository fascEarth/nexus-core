import { Component, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { EventHub } from '../core/event-hub.service';

/** One approval inbox across every module; refreshes live. */
@Component({
  selector: 'nx-inbox',
  imports: [RouterLink, DatePipe],
  template: `
    <h1>My approvals</h1>
    <div class="card table-wrap">
      <table>
        <thead><tr><th>Record</th><th>Module</th><th>Step</th><th>Waiting since</th><th>Due</th></tr></thead>
        <tbody>
          @for (t of tasks(); track t.taskId) {
            <tr [routerLink]="['/app', t.entity, t.recordId]">
              <td><b>{{ t.number ?? t.recordId }}</b></td><td>{{ t.entity }}</td><td><span class="pill">{{ t.state }}</span></td>
              <td>{{ t.createdAt | date: 'short' }}</td>
              <td [class.overdue]="t.dueAt && isOverdue(t.dueAt)">{{ t.dueAt ? (t.dueAt | date: 'short') : '—' }}</td>
            </tr>
          } @empty { <tr><td colspan="5" class="muted pad">Nothing waiting for you 🎉</td></tr> }
        </tbody>
      </table>
    </div>
  `,
})
export class InboxPage implements OnInit {
  private api = inject(Api);
  private hub = inject(EventHub);
  tasks = signal<Awaited<ReturnType<Api['inbox']>>>([]);

  constructor() {
    this.hub.events$.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (e.type.startsWith('workflow.') || e.type.startsWith('record.')) void this.load();
    });
  }

  ngOnInit() {
    void this.load();
  }

  isOverdue(d: string) {
    return new Date(d).getTime() < Date.now();
  }

  private async load() {
    this.tasks.set(await this.api.inbox());
  }
}
