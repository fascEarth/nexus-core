import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import type { DomainEvent } from '@nexus/shared-types';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { ConsumerRegistry } from '../events/consumer-runner.service';
import { EventConsumer, matchesType } from '../events/event-consumer';
import { EventBus } from '../events/event-bus.service';
import { NotificationService } from '../notify/notification.service';
import { AuditService } from '../audit/audit.service';
import { Condition, evaluate, renderDeep } from '../common/conditions';
import { currentContext } from '../context/request-context';

/** SSRF guard: https only, and the host must not resolve to a private/loopback/link-local address. */
export async function assertPublicHttps(url: string) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('Webhooks must use https');
  const { address } = await lookup(u.hostname);
  if (isPrivateIp(address)) throw new Error('Webhook host resolves to a private address');
}

export function isPrivateIp(ip: string): boolean {
  if (ip.includes(':')) {
    const v6 = ip.toLowerCase();
    return v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('::ffff:127.') || v6.startsWith('::ffff:10.') || v6.startsWith('::ffff:192.168.');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/**
 * Supported actions. Each runs inside the rule's transaction with
 * actor = rule, so its own events carry causation + depth (loop guard).
 */
export type RuleAction =
  | { action: 'notify'; to: string[]; title: string; body?: string; link?: string }
  | { action: 'record.update'; entity: string; id: string; set: Record<string, unknown> }
  | { action: 'record.create'; entity: string; data: Record<string, unknown> }
  | { action: 'emit'; type: string; data?: Record<string, unknown> }
  | { action: 'webhook'; url: string; body?: Record<string, unknown> };

export interface RuleDefinition {
  name: string;
  eventType: string;
  condition: Condition | Record<string, never>;
  actions: RuleAction[];
  active?: boolean;
}

/** "When → If → Then" automations, stored as data, evaluated on every event. */
@Injectable()
export class RulesService implements EventConsumer, OnModuleInit {
  readonly consumerName = 'rules';
  private readonly logger = new Logger(RulesService.name);
  private cache = new Map<string, { rules: Prisma.RuleGetPayload<object>[]; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ConsumerRegistry,
    private readonly events: EventBus,
    private readonly notify: NotificationService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  handles(type: string) {
    // Never react to our own bookkeeping events.
    return !type.startsWith('notification.') && !type.startsWith('rule.');
  }

  async handle(event: DomainEvent) {
    const rules = (await this.rulesFor(event.tenantId)).filter((r) => matchesType(r.eventType, event.type));
    for (const rule of rules) await this.run(rule, event, false);
  }

  /** Dry run for the rule builder: evaluates and returns actions without executing. */
  async test(def: RuleDefinition, sample: DomainEvent) {
    const facts = this.facts(sample);
    const matched = evaluate(def.condition as Condition, facts);
    return { matched, actions: matched ? def.actions.map((a) => renderDeep(a, facts)) : [] };
  }

  invalidate(tenantId: string) {
    this.cache.delete(tenantId);
  }

  validate(def: RuleDefinition) {
    for (const a of def.actions) {
      if (a.action === 'webhook' && !/^https:\/\//.test(a.url)) throw new BadRequestException('Webhooks must use https');
    }
  }

  private async run(rule: Prisma.RuleGetPayload<object>, event: DomainEvent, dryRun: boolean) {
    const facts = this.facts(event);
    const matched = evaluate(rule.condition as unknown as Condition, facts);
    const ctx = currentContext();
    ctx.actor = { type: 'rule', id: rule.id };

    await this.prisma.tx(async (tx) => {
      const results: unknown[] = [];
      let error: string | undefined;
      if (matched && !dryRun) {
        try {
          for (const raw of rule.actions as unknown as RuleAction[]) {
            results.push(await this.execute(tx, renderDeep(raw, facts), event));
          }
        } catch (e) {
          error = (e as Error).message;
          this.logger.warn(`Rule "${rule.name}" failed: ${error}`);
        }
      }
      await tx.ruleRun.create({
        data: { tenantId: event.tenantId, ruleId: rule.id, eventId: event.id, matched, result: results as Prisma.InputJsonValue, error },
      });
    }, event.tenantId);
  }

  private facts(event: DomainEvent) {
    const data = (event.data ?? {}) as Record<string, unknown>;
    return { event, data, before: data.before ?? null, after: data.after ?? data.record ?? null, entity: event.entity, actor: event.actor };
  }

  private async execute(tx: Tx, a: RuleAction, event: DomainEvent): Promise<unknown> {
    switch (a.action) {
      case 'notify': {
        const ids = await this.notify.resolveRecipients(tx, a.to.map((t) => (t === 'owner' ? `user:${(event.data as { after?: { ownerId?: string } }).after?.ownerId ?? ''}` : t)));
        await this.notify.create(tx, ids, { title: a.title, body: a.body, link: a.link });
        return { notified: ids.length };
      }
      case 'record.update': {
        const rec = await tx.record.findFirst({ where: { id: a.id, entity: a.entity, deletedAt: null } });
        if (!rec) throw new Error(`Record ${a.entity}/${a.id} not found`);
        const before = rec.data as Record<string, unknown>;
        const after = { ...before, ...a.set };
        await tx.record.update({ where: { id: rec.id }, data: { data: after as Prisma.InputJsonValue, version: { increment: 1 } } });
        await this.audit.record(tx, { action: 'rule.update', entity: a.entity, entityId: rec.id, before, after });
        await this.events.emit(tx, { type: `record.${a.entity}.updated`, entity: { name: a.entity, id: rec.id }, data: { before, after: { ...after, id: rec.id, ownerId: rec.ownerId, status: rec.status }, changed: Object.keys(a.set) } });
        return { updated: rec.id };
      }
      case 'record.create': {
        const owner = (event.actor.type === 'user' ? event.actor.id : undefined) ?? 'system';
        const rec = await tx.record.create({
          data: { tenantId: event.tenantId, entity: a.entity, data: a.data as Prisma.InputJsonValue, ownerId: owner, createdBy: owner, updatedBy: owner },
        });
        await this.audit.record(tx, { action: 'rule.create', entity: a.entity, entityId: rec.id, after: a.data });
        await this.events.emit(tx, { type: `record.${a.entity}.created`, entity: { name: a.entity, id: rec.id }, data: { before: null, after: { ...a.data, id: rec.id, ownerId: owner } } });
        return { created: rec.id };
      }
      case 'emit':
        await this.events.emit(tx, { type: a.type, data: a.data ?? {} });
        return { emitted: a.type };
      case 'webhook': {
        await assertPublicHttps(a.url);
        const res = await fetch(a.url, {
          redirect: 'error',
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-nexus-event': event.type },
          body: JSON.stringify(a.body ?? event),
          signal: AbortSignal.timeout(5000),
        });
        return { status: res.status };
      }
    }
  }

  private async rulesFor(tenantId: string) {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < 30_000) return hit.rules;
    const rules = await this.prisma.tx((tx) => tx.rule.findMany({ where: { active: true } }), tenantId);
    this.cache.set(tenantId, { rules, at: Date.now() });
    return rules;
  }
}
