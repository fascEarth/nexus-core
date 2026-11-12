import type { DomainEvent } from '@nexus/shared-types';

/**
 * Implement and register with ConsumerRegistry to react to events.
 * Each consumer gets its own Redis consumer group: it reads every event
 * independently and retries on its own.
 */
export interface EventConsumer {
  /** Stable, unique name. Changing it re-reads the stream from the start. */
  readonly consumerName: string;
  /** Cheap filter: return false to skip without touching the DB. */
  handles(eventType: string): boolean;
  /** Must be idempotent-safe; the runner also dedupes by event id. */
  handle(event: DomainEvent): Promise<void>;
}

/** Glob-ish matcher: `record.*.created`, `hrms.**`, `*`. */
export function matchesType(pattern: string, type: string): boolean {
  if (pattern === '*' || pattern === '**') return true;
  const re = new RegExp(
    '^' + pattern.split('.').map((p) => (p === '**' ? '.*' : p === '*' ? '[^.]+' : p.replace(/[$()+?[\]\\^{}|]/g, '\\$&'))).join('\\.') + '$',
  );
  return re.test(type);
}
