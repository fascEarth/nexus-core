import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { EntityDefinition } from '@nexus/shared-types';
import { config } from './config';

export interface RecordRow {
  id: string;
  number: string | null;
  status: string | null;
  version: number;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  data: Record<string, unknown>;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface WorkflowInfo {
  state: string;
  stateLabel?: string;
  final: boolean;
  transitions: { name: string; label: string; to: string; requireComment: boolean }[];
  history: { fromState: string; toState: string; transition: string; actorId: string; comment?: string; createdAt: string }[];
}

export interface Overview {
  days: string[];
  entities: { name: string; label: string; total: number; byStatus: { status: string; count: number }[]; daily: number[] }[];
  tasks: { open: number; overdue: number };
  events: { hourly: { hour: string; count: number }[]; byType: { type: string; count: number }[]; pending: number; deadLetters: number; total24h: number } | null;
  workflow: { state: string; count: number }[] | null;
  rules: { runs24h: number; matched24h: number; errors24h: number } | null;
  users: { active: number; total: number } | null;
  activity: { id: string; action: string; entity: string; entityId: string; number: string | null; actor: string; actorType: string; createdAt: string }[];
}

export interface AuditRow {
  id: string; actor: string; actorType: string; actorId: string; action: string; entity: string; entityId: string; subject?: string | null; ip?: string | null; createdAt: string;
  changes: { field: string; from: unknown; to: unknown }[];
}

export interface Member {
  id: string; userId: string; name: string; email: string; status: string; lastLoginAt?: string | null; createdAt: string; manager: string | null;
  roles: { id: string; key: string; name: string }[]; orgUnits: string[];
}

export interface RoleInfo {
  id: string; key: string; name: string; description?: string | null; system: boolean; members: number;
  permissions: { permission: string; scope: string; conditional: boolean }[];
  fields: { entity: string; field: string; mode: string }[];
}

export interface OutboxRow {
  id: string; type: string; createdAt: string; publishedAt: string | null; attempts: number; lastError: string | null;
  actor: { type: string; id: string } | null; entity: { name: string; id: string } | null; correlationId: string | null; causationId: string | null; depth: number;
}

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  private base = config.apiUrl;
  readonly entities = signal<EntityDefinition[]>([]);

  async loadEntities() {
    this.entities.set(await firstValueFrom(this.http.get<EntityDefinition[]>(`${this.base}/meta/entities`)));
    return this.entities();
  }

  entity(name: string) {
    return firstValueFrom(this.http.get<EntityDefinition>(`${this.base}/meta/entities/${name}`));
  }

  list(entity: string, q: { page?: number; pageSize?: number; search?: string; status?: string } = {}) {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') params = params.set(k, String(v));
    return firstValueFrom(this.http.get<Page<RecordRow>>(`${this.base}/data/${entity}`, { params }));
  }

  get(entity: string, id: string) {
    return firstValueFrom(this.http.get<RecordRow>(`${this.base}/data/${entity}/${id}`));
  }

  create(entity: string, data: Record<string, unknown>) {
    return firstValueFrom(this.http.post<RecordRow>(`${this.base}/data/${entity}`, { data }));
  }

  update(entity: string, id: string, data: Record<string, unknown>, version: number) {
    return firstValueFrom(this.http.patch<RecordRow>(`${this.base}/data/${entity}/${id}`, { data, version }));
  }

  history(entity: string, id: string) {
    return firstValueFrom(this.http.get<{ action: string; actorType: string; actorId: string; createdAt: string; before: unknown; after: unknown }[]>(`${this.base}/data/${entity}/${id}/history`));
  }

  workflow(entity: string, id: string) {
    return firstValueFrom(this.http.get<WorkflowInfo>(`${this.base}/workflow/${entity}/${id}`));
  }

  transition(entity: string, id: string, transition: string, comment?: string) {
    return firstValueFrom(this.http.post<{ state: string }>(`${this.base}/workflow/${entity}/${id}/transition`, { transition, comment }));
  }

  inbox() {
    return firstValueFrom(this.http.get<{ taskId: string; entity: string; recordId: string; number?: string; state: string; dueAt?: string; createdAt: string; data: Record<string, unknown> }[]>(`${this.base}/workflow/inbox`));
  }

  notifications() {
    return firstValueFrom(this.http.get<{ id: string; title: string; body?: string; link?: string; readAt?: string; createdAt: string }[]>(`${this.base}/notifications`));
  }

  markRead(id: string) {
    return firstValueFrom(this.http.post(`${this.base}/notifications/${id}/read`, {}));
  }

  overview() {
    return firstValueFrom(this.http.get<Overview>(`${this.base}/insights/overview`));
  }

  audit(q: { entity?: string; entityId?: string; actorId?: string; action?: string; page?: number } = {}) {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') params = params.set(k, String(v));
    return firstValueFrom(this.http.get<Page<AuditRow> & { entities: string[] }>(`${this.base}/audit`, { params }));
  }

  members() {
    return firstValueFrom(this.http.get<Member[]>(`${this.base}/admin/users`));
  }

  roles() {
    return firstValueFrom(this.http.get<RoleInfo[]>(`${this.base}/admin/roles`));
  }

  setRoles(tenantUserId: string, roleIds: string[]) {
    return firstValueFrom(this.http.put<{ ok: boolean; roles: string[] }>(`${this.base}/admin/users/${tenantUserId}/roles`, { roleIds }));
  }

  setMemberStatus(tenantUserId: string, status: 'active' | 'suspended') {
    return firstValueFrom(this.http.put<{ ok: boolean }>(`${this.base}/admin/users/${tenantUserId}/status`, { status }));
  }

  recentEvents(type?: string) {
    let params = new HttpParams();
    if (type) params = params.set('type', type);
    return firstValueFrom(this.http.get<OutboxRow[]>(`${this.base}/events/recent`, { params }));
  }

  eventStats() {
    return firstValueFrom(this.http.get<{ pending: number; lastHour: number; failing: number; deadLetters: number; consumers: string[] }>(`${this.base}/events/stats`));
  }

  deadLetters() {
    return firstValueFrom(this.http.get<{ id: string; consumer: string; eventId: string; error: string; createdAt: string; payload: { type?: string } }[]>(`${this.base}/events/dead-letters`));
  }

  replay(id: string) {
    return firstValueFrom(this.http.post<{ replayed: boolean }>(`${this.base}/events/dead-letters/${id}/replay`, {}));
  }

  rules() {
    return firstValueFrom(this.http.get<{ id: string; name: string; eventType: string; condition: unknown; actions: unknown; active: boolean }[]>(`${this.base}/rules`));
  }

  saveRule(rule: unknown, id?: string) {
    return firstValueFrom(id ? this.http.put(`${this.base}/rules/${id}`, rule) : this.http.post(`${this.base}/rules`, rule));
  }

  testRule(rule: unknown, event: unknown) {
    return firstValueFrom(this.http.post<{ matched: boolean; actions: unknown[] }>(`${this.base}/rules/test`, { rule, event }));
  }
}

export function errorMessage(err: unknown): string {
  const e = err as { error?: { message?: string | string[]; errors?: string[] }; message?: string };
  if (e?.error?.errors?.length) return e.error.errors.join(' · ');
  const m = e?.error?.message ?? e?.message;
  return Array.isArray(m) ? m.join(' · ') : m ?? 'Something went wrong';
}
