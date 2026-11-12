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
