import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import type { EventActor } from '@nexus/shared-types';
import type { AppUser } from '../access/access.types';

/**
 * Per-request (or per-event) context, carried through async calls.
 * HTTP requests, socket messages and event consumers all run inside one.
 */
export interface RequestContext {
  correlationId: string;
  tenantId?: string;
  user?: AppUser;
  actor: EventActor;
  ip?: string;
  /** Event that caused the current work (set inside consumers). */
  causationId?: string;
  /** Causation chain depth (loop guard). */
  depth: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runInContext<T>(context: Partial<RequestContext>, fn: () => T): T {
  const full: RequestContext = {
    correlationId: context.correlationId ?? randomUUID(),
    actor: context.actor ?? { type: 'system', id: 'system' },
    depth: context.depth ?? 0,
    ...context,
  } as RequestContext;
  return storage.run(full, fn);
}

export function currentContext(): RequestContext {
  const store = storage.getStore();
  if (!store) throw new Error('No request context. Wrap work in runInContext().');
  return store;
}

export function maybeContext(): RequestContext | undefined {
  return storage.getStore();
}

export function currentTenantId(): string {
  const tenantId = maybeContext()?.tenantId;
  if (!tenantId) throw new UnauthorizedException('Tenant not resolved');
  return tenantId;
}

export function currentUser(): AppUser {
  const user = maybeContext()?.user;
  if (!user) throw new UnauthorizedException();
  return user;
}
