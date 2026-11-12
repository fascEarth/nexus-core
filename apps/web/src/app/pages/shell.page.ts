import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { Api } from '../core/api.service';
import { EventHub } from '../core/event-hub.service';
import { CanDirective } from '../core/can.directive';

interface Toast {
  id: number;
  title: string;
  body?: string;
}

@Component({
  selector: 'nx-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, DatePipe, CanDirective],
  template: `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><span class="logo">N</span> {{ auth.tokens()?.tenant?.name }}</div>
        <nav>
          <a routerLink="/app" [routerLinkActiveOptions]="{ exact: true }" routerLinkActive="active">Home</a>
          <a routerLink="/app/inbox" routerLinkActive="active">Approvals @if (inboxCount()) {<span class="badge">{{ inboxCount() }}</span>}</a>
          <div class="nav-label">Modules</div>
          @for (e of api.entities(); track e.name) {
            <a [routerLink]="['/app', e.name]" routerLinkActive="active">{{ e.pluralLabel }}</a>
          }
          <ng-container *nxCan="'rules:read'">
            <div class="nav-label">Automation</div>
            <a routerLink="/app/rules" routerLinkActive="active">Rules</a>
          </ng-container>
        </nav>
        <div class="sidebar-foot">
          <span class="dot" [class.on]="hub.connected()"></span> {{ hub.connected() ? 'Live' : 'Offline' }}
        </div>
      </aside>

      <div class="main">
        <header class="topbar">
          <div></div>
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
  inboxCount = signal(0);
  showNotifications = signal(false);
  toasts = signal<Toast[]>([]);

  async ngOnInit() {
    this.hub.connect();
    await this.api.loadEntities();
    await Promise.all([this.refreshNotifications(), this.refreshInbox()]);

    this.hub.notifications$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((n) => {
      this.toast(n.title, n.body);
      void this.refreshNotifications();
      void this.refreshInbox();
    });
    this.hub.metadata$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.api.loadEntities());
    this.hub.events$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((e) => {
      if (e.type.startsWith('workflow.')) void this.refreshInbox();
    });
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

  private async refreshInbox() {
    this.inboxCount.set((await this.api.inbox()).length);
  }

  private toast(title: string, body?: string) {
    const id = Date.now() + Math.random();
    this.toasts.update((t) => [...t, { id, title, body }]);
    setTimeout(() => this.toasts.update((t) => t.filter((x) => x.id !== id)), 5000);
  }
}
