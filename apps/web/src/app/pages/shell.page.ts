import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { Api } from '../core/api.service';
import { EventHub } from '../core/event-hub.service';
import { CanDirective } from '../core/can.directive';
import { environment } from '../../environments/environment';
import { CommandPalette } from '../shared/command-palette';

interface Toast {
  id: number;
  title: string;
  body?: string;
}

@Component({
  selector: 'nx-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, DatePipe, CanDirective, CommandPalette],
  template: `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><span class="logo">N</span> {{ auth.tokens()?.tenant?.name }}</div>
        <nav>
          <a routerLink="/app" [routerLinkActiveOptions]="{ exact: true }" routerLinkActive="active">Home</a>
          <div class="nav-label">Food delivery</div>
          <a routerLink="/app/ops" routerLinkActive="active">Live operations</a>
          <a routerLink="/app/insights" routerLinkActive="active">Business insights</a>
          <a href="/" target="_blank" rel="noopener">Customer app ↗</a>
          <a href="/partner" target="_blank" rel="noopener">Restaurant app ↗</a>
          <div class="nav-label">Data (metadata entities)</div>
          @for (e of api.entities(); track e.name) {
            <a [routerLink]="['/app', e.name]" routerLinkActive="active">{{ e.pluralLabel }}</a>
          }
          <ng-container *nxCan="'rules:read'">
            <div class="nav-label">Automation</div>
            <a routerLink="/app/rules" routerLinkActive="active">Rules</a>
          </ng-container>
          @if (auth.can('users', 'read') || auth.can('audit', 'read') || auth.can('events', 'admin')) {
            <div class="nav-label">Administration</div>
            <a *nxCan="'users:read'" routerLink="/app/people" routerLinkActive="active">People &amp; access</a>
            <a *nxCan="'audit:read'" routerLink="/app/activity" routerLinkActive="active">Activity log</a>
            <a *nxCan="'events:admin'" routerLink="/app/events" routerLinkActive="active">Event monitor</a>
          }
        </nav>
        @if (demo) {
          <div class="demo-side">
            <b>Live demo</b>
            <span>Open another tab and sign in as a different user to watch updates flow between them.</span>
            <a href="/login" target="_blank" rel="noopener">Open a new tab →</a>
            <button class="link" (click)="resetDemo()">Reset demo data</button>
          </div>
        }
        <div class="sidebar-foot">
          <span class="dot" [class.on]="hub.connected()"></span> {{ hub.connected() ? 'Live' : 'Offline' }}
        </div>
      </aside>

      <div class="main">
        <header class="topbar">
          <button class="search-trigger" (click)="openPalette()"><span>Search or jump to…</span><kbd>Ctrl K</kbd></button>
          <div class="top-actions">
            <button class="btn ghost" (click)="toggleNotifications()" aria-label="Notifications">
              🔔 @if (unread()) {<span class="badge">{{ unread() }}</span>}
            </button>
            <span class="muted">{{ auth.me()?.name }}</span>
            <button class="btn ghost" (click)="auth.logout()">Sign out</button>
          </div>
          @if (showNotifications()) {
            <div class="card dropdown">
              @for (n of notifications(); track n.id) {
                <a class="note" [class.unread]="!n.readAt" [routerLink]="n.link || null" (click)="read(n.id)">
                  <b>{{ n.title }}</b>
                  @if (n.body) {<span>{{ n.body }}</span>}
                  <small class="muted">{{ n.createdAt | date: 'short' }}</small>
                </a>
              } @empty { <p class="muted pad">No notifications</p> }
            </div>
          }
        </header>
        <section class="content"><router-outlet /></section>
      </div>

      <nx-command-palette />
      <div class="toasts" aria-live="polite">
        @for (t of toasts(); track t.id) {
          <div class="toast"><b>{{ t.title }}</b>@if (t.body) {<span>{{ t.body }}</span>}</div>
        }
      </div>
    </div>
  `,
})
export class ShellPage implements OnInit {
  auth = inject(AuthService);
  api = inject(Api);
  hub = inject(EventHub);
  private destroyRef = inject(DestroyRef);

  notifications = signal<Awaited<ReturnType<Api['notifications']>>>([]);
  unread = signal(0);
  showNotifications = signal(false);
  toasts = signal<Toast[]>([]);
  demo = environment.demo;

  async resetDemo() {
    if (!confirm('Reset all demo data in this browser?')) return;
    (await import('../demo/nexus-demo-backend')).resetDemo();
    location.href = '/app';
  }

  async ngOnInit() {
    this.hub.connect();
    await this.api.loadEntities();
    await this.refreshNotifications();

    this.hub.notifications$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((n) => {
      this.toast(n.title, n.body);
      void this.refreshNotifications();
    });
    this.hub.metadata$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.api.loadEntities());
  }

  openPalette() {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
  }

  toggleNotifications() {
    this.showNotifications.update((v) => !v);
  }

  async read(id: string) {
    await this.api.markRead(id);
    this.showNotifications.set(false);
    await this.refreshNotifications();
  }

  private async refreshNotifications() {
    const list = await this.api.notifications();
    this.notifications.set(list);
    this.unread.set(list.filter((n) => !n.readAt).length);
  }

  private toast(title: string, body?: string) {
    const id = Date.now() + Math.random();
    this.toasts.update((t) => [...t, { id, title, body }]);
    setTimeout(() => this.toasts.update((t) => t.filter((x) => x.id !== id)), 5000);
  }
}
