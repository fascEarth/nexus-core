import { Controller, Get, Global, Injectable, Module, Param, Post } from '@nestjs/common';
import type { Tx } from '../prisma/prisma.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventBus } from '../events/event-bus.service';
import { currentTenantId, currentUser } from '../context/request-context';

export interface NotificationInput {
  title: string;
  body?: string;
  link?: string;
}

/**
 * In-app notifications. Emits `notification.created`; the realtime consumer
 * pushes it to the user's socket room. Email / SMS / WhatsApp channels plug in
 * as further consumers of the same event.
 */
@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService, private readonly events: EventBus) {}

  async create(tx: Tx, userIds: string[], input: NotificationInput) {
    const unique = [...new Set(userIds)].filter(Boolean);
    if (!unique.length) return;
    const tenantId = currentTenantId();
    await tx.notification.createMany({ data: unique.map((userId) => ({ tenantId, userId, ...input })) });
    await this.events.emit(tx, { type: 'notification.created', data: { userIds: unique, ...input } });
  }

  /** Resolve `user:<id>`, `role:<key>`, or a raw userId list into user ids. */
  async resolveRecipients(tx: Tx, targets: string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const t of targets) {
      if (t.startsWith('role:')) {
        const members = await tx.userRole.findMany({ where: { role: { key: t.slice(5) } }, include: { tenantUser: true } });
        ids.push(...members.map((m) => m.tenantUser.userId));
      } else {
        ids.push(t.replace(/^user:/, ''));
      }
    }
    return [...new Set(ids)];
  }
}

@Controller('notifications')
export class NotificationController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  mine() {
    const user = currentUser();
    return this.prisma.tx((tx) => tx.notification.findMany({ where: { userId: user.userId }, orderBy: { createdAt: 'desc' }, take: 50 }));
  }

  @Post(':id/read')
  async read(@Param('id') id: string) {
    const user = currentUser();
    await this.prisma.tx((tx) => tx.notification.updateMany({ where: { id, userId: user.userId }, data: { readAt: new Date() } }));
    return { ok: true };
  }
}

@Global()
@Module({ controllers: [NotificationController], providers: [NotificationService], exports: [NotificationService] })
export class NotifyModule {}
