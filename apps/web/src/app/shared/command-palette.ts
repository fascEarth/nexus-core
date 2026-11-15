import { Component, computed, ElementRef, HostListener, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api } from '../core/api.service';
import { AuthService } from '../core/auth.service';

interface Item { label: string; hint: string; group: string; url: string }

/** Ctrl/⌘ + K: jump to any page or search records across every module you can read. */
@Component({
  selector: 'nx-command-palette',
  imports: [FormsModule],
  template: `
    @if (open()) {
      <div class="palette-backdrop" (click)="close()">
        <div class="palette card" role="dialog" aria-label="Search" (click)="$event.stopPropagation()">
          <input #box [ngModel]="q()" (ngModelChange)="search($event)" placeholder="Search records or jump to a page…" (keydown)="key($event)" aria-label="Search" autocomplete="off" />
          <ul class="palette-list" role="listbox">
            @for (it of items(); track it.url + it.label; let i = $index) {
              @if (i === 0 || items()[i - 1].group !== it.group) {<li class="palette-group">{{ it.group }}</li>}
              <li role="option" [class.active]="i === cursor()" [attr.aria-selected]="i === cursor()" (mouseenter)="cursor.set(i)" (click)="go(it)">
                <span>{{ it.label }}</span><small class="muted">{{ it.hint }}</small>
              </li>
            } @empty {<li class="muted pad">{{ busy() ? 'Searching…' : 'No matches' }}</li>}
          </ul>
          <div class="palette-foot muted small">↑↓ to move · Enter to open · Esc to close</div>
        </div>
      </div>
    }
  `,
})
export class CommandPalette {
  private api = inject(Api);
  private auth = inject(AuthService);
  private router = inject(Router);
  private box = viewChild<ElementRef<HTMLInputElement>>('box');
  open = signal(false);
  q = signal('');
  cursor = signal(0);
  busy = signal(false);
  results = signal<Item[]>([]);
  private timer?: ReturnType<typeof setTimeout>;
  private seq = 0;

  private pages = computed<Item[]>(() => {
    const p: Item[] = [
      { label: 'Home', hint: 'Dashboard', group: 'Pages', url: '/app' },
      { label: 'Approvals', hint: 'Your inbox', group: 'Pages', url: '/app/inbox' },
    ];
    for (const e of this.api.entities()) {
      p.push({ label: e.pluralLabel, hint: 'Module', group: 'Pages', url: `/app/${e.name}` });
      if (this.auth.can(e.name, 'create')) p.push({ label: `New ${e.label.toLowerCase()}`, hint: 'Create', group: 'Actions', url: `/app/${e.name}/new` });
    }
    if (this.auth.can('rules', 'read')) p.push({ label: 'Rules', hint: 'Automation', group: 'Pages', url: '/app/rules' });
    if (this.auth.can('audit', 'read')) p.push({ label: 'Activity & audit log', hint: 'Admin', group: 'Pages', url: '/app/activity' });
    if (this.auth.can('users', 'read')) p.push({ label: 'People & access', hint: 'Admin', group: 'Pages', url: '/app/people' });
    if (this.auth.can('events', 'admin')) p.push({ label: 'Event monitor', hint: 'Admin', group: 'Pages', url: '/app/events' });
    return p;
  });

  items = computed(() => {
    const q = this.q().trim().toLowerCase();
    const pages = this.pages().filter((p) => !q || p.label.toLowerCase().includes(q) || p.hint.toLowerCase().includes(q));
    return [...pages, ...this.results()].slice(0, 14);
  });

  @HostListener('window:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.open() ? this.close() : this.show();
    }
  }

  show() {
    this.open.set(true);
    this.q.set('');
    this.results.set([]);
    this.cursor.set(0);
    setTimeout(() => this.box()?.nativeElement.focus());
  }

  close() {
    this.open.set(false);
  }

  search(v: string) {
    this.q.set(v);
    this.cursor.set(0);
    clearTimeout(this.timer);
    if (v.trim().length < 2) {
      this.results.set([]);
      return;
    }
    this.timer = setTimeout(() => void this.run(v.trim()), 220);
  }

  private async run(term: string) {
    const id = ++this.seq;
    this.busy.set(true);
    const entities = this.api.entities().filter((e) => this.auth.can(e.name, 'read'));
    const pages = await Promise.all(entities.map((e) => this.api.list(e.name, { search: term, pageSize: 5 }).then((p) => ({ e, p })).catch(() => null)));
    if (id !== this.seq) return;
    const out: Item[] = [];
    for (const r of pages) {
      if (!r) continue;
      for (const row of r.p.items) {
        const d = row.data;
        const title = [row.number, d['leaveType'] ?? d['category'] ?? d['name'] ?? d['title'], d['merchant'] ?? d['reason']].filter(Boolean).join(' · ');
        out.push({ label: title || row.id, hint: `${r.e.label}${row.status ? ' · ' + row.status : ''}`, group: 'Records', url: `/app/${r.e.name}/${row.id}` });
      }
    }
    this.results.set(out);
    this.busy.set(false);
  }

  key(e: KeyboardEvent) {
    const n = this.items().length;
    if (e.key === 'ArrowDown') { e.preventDefault(); this.cursor.set(n ? (this.cursor() + 1) % n : 0); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.cursor.set(n ? (this.cursor() - 1 + n) % n : 0); }
    else if (e.key === 'Enter') { const it = this.items()[this.cursor()]; if (it) this.go(it); }
    else if (e.key === 'Escape') this.close();
  }

  go(it: Item) {
    this.close();
    void this.router.navigateByUrl(it.url);
  }
}
