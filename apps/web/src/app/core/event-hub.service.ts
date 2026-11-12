import { inject, Injectable, OnDestroy, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import type { LivePatch } from '@nexus/shared-types';
import { AuthService } from './auth.service';
import { config } from './config';

export interface LiveNotification {
  title: string;
  body?: string;
  link?: string;
}

export interface LiveEvent {
  type: string;
  entity?: { name: string; id: string };
  at: Date;
}

/**
 * The frontend side of the event bus. One socket per tab; pages subscribe to
 * entities and receive permission-filtered patches. Any page can react to an
 * action taken on another page (or by another user, a rule, or the AI agent).
 */
@Injectable({ providedIn: 'root' })
export class EventHub implements OnDestroy {
  private auth = inject(AuthService);
  private socket?: Socket;
  private subscribed = new Map<string, number>();

  readonly connected = signal(false);
  readonly patches$ = new Subject<LivePatch>();
  readonly notifications$ = new Subject<LiveNotification>();
  readonly events$ = new Subject<LiveEvent>();
  readonly metadata$ = new Subject<{ entity: string }>();
  readonly recent = signal<LiveEvent[]>([]);

  connect() {
    const token = this.auth.tokens()?.accessToken;
    if (!token || this.socket) return;
    this.socket = io(config.wsUrl, { auth: { token }, transports: ['websocket'] });
    this.socket.on('connect', () => {
      this.connected.set(true);
      for (const entity of this.subscribed.keys()) this.socket!.emit('subscribe', { entity });
    });
    this.socket.on('disconnect', () => this.connected.set(false));
    this.socket.on('connect_error', async () => {
      // Token probably expired: refresh and reconnect with the new one.
      if (await this.auth.refresh()) {
        this.socket!.auth = { token: this.auth.tokens()?.accessToken };
      }
    });
    this.socket.on('patch', (p: LivePatch) => this.patches$.next(p));
    this.socket.on('notification', (n: LiveNotification) => this.notifications$.next(n));
    this.socket.on('metadata', (m: { entity: string }) => this.metadata$.next(m));
    this.socket.on('event', (e: Omit<LiveEvent, 'at'>) => {
      const ev = { ...e, at: new Date() };
      this.events$.next(ev);
      this.recent.update((list) => [ev, ...list].slice(0, 30));
    });
  }

  /** Reference-counted, so several components can watch the same entity. */
  watch(entity: string): () => void {
    const n = this.subscribed.get(entity) ?? 0;
    this.subscribed.set(entity, n + 1);
    if (n === 0) this.socket?.emit('subscribe', { entity });
    return () => {
      const left = (this.subscribed.get(entity) ?? 1) - 1;
      if (left <= 0) {
        this.subscribed.delete(entity);
        this.socket?.emit('unsubscribe', { entity });
      } else this.subscribed.set(entity, left);
    };
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = undefined;
    this.connected.set(false);
  }

  ngOnDestroy() {
    this.disconnect();
  }
}
