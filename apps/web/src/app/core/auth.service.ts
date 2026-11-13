import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { CompiledPermission, FieldMask } from '@nexus/shared-types';
import { config } from './config';
import { environment } from '../../environments/environment';

/** Demo: per-tab sessions, so two tabs can be two different users. */
const store = (): Storage => (environment.demo ? sessionStorage : localStorage);

interface Tokens {
  accessToken: string;
  refreshToken: string;
  tenant: { id: string; slug: string; name: string };
}

export interface Me {
  userId: string;
  tenantId: string;
  email: string;
  name: string;
  roles: string[];
  permissions: CompiledPermission[];
  fieldMask: FieldMask;
}

const KEY = 'nexus.session';

function load(): Tokens | null {
  try {
    const raw = store().getItem(KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}

function save(tokens: Tokens | null) {
  try {
    if (tokens) store().setItem(KEY, JSON.stringify(tokens));
    else store().removeItem(KEY);
  } catch {
    /* storage unavailable: session lives in memory only */
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  readonly tokens = signal<Tokens | null>(load());
  readonly me = signal<Me | null>(null);
  readonly loggedIn = computed(() => !!this.tokens());
  private refreshing: Promise<boolean> | null = null;

  async login(tenant: string, email: string, password: string) {
    const tokens = await firstValueFrom(this.http.post<Tokens>(`${config.apiUrl}/auth/login`, { tenant, email, password }));
    this.set(tokens);
    await this.loadMe();
  }

  async loadMe() {
    this.me.set(await firstValueFrom(this.http.get<Me>(`${config.apiUrl}/auth/me`)));
    return this.me();
  }

  /** Single-flight refresh shared by all failing requests. */
  refresh(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;
    const current = this.tokens();
    if (!current) return Promise.resolve(false);
    this.refreshing = firstValueFrom(this.http.post<Tokens>(`${config.apiUrl}/auth/refresh`, { refreshToken: current.refreshToken }))
      .then((t) => { this.set(t); return true; })
      .catch(() => { this.clear(); return false; })
      .finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  async logout() {
    const current = this.tokens();
    if (current) await firstValueFrom(this.http.post(`${config.apiUrl}/auth/logout`, { refreshToken: current.refreshToken })).catch(() => undefined);
    this.clear();
    await this.router.navigateByUrl('/login');
  }

  /** Mirrors the server's permission check so the UI can hide what the API would refuse. */
  can(resource: string, action: string): boolean {
    return (this.me()?.permissions ?? []).some((p) => {
      const [r, a] = p.key.split(':');
      return (r === '*' || r === resource) && (a === '*' || a === action);
    });
  }

  private set(tokens: Tokens) {
    this.tokens.set(tokens);
    save(tokens);
  }

  private clear() {
    this.tokens.set(null);
    this.me.set(null);
    save(null);
  }
}
