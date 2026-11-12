import { Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import type { DomainEvent, LivePatch } from '@nexus/shared-types';
import { AccessService } from '../access/access.service';
import type { AccessTokenClaims } from '../access/auth.guard';
import type { AppUser } from '../access/access.types';
import { ConsumerRegistry } from '../events/consumer-runner.service';
import type { EventConsumer } from '../events/event-consumer';

const room = {
  tenant: (t: string) => `t:${t}`,
  user: (t: string, u: string) => `t:${t}:user:${u}`,
  entity: (t: string, e: string) => `t:${t}:entity:${e}`,
};

/**
 * Live sync. Clients connect with their access token, then `subscribe` to
 * entities. Every committed change arrives as a LivePatch, filtered per socket
 * by record scope and field mask: nobody receives data they can't read.
 */
@Injectable()
@WebSocketGateway({ cors: { origin: (process.env.CORS_ORIGINS ?? 'http://localhost:4200').split(','), credentials: true } })
export class RealtimeGateway implements OnGatewayConnection, EventConsumer, OnModuleInit {
  readonly consumerName = 'realtime';
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly access: AccessService,
    private readonly registry: ConsumerRegistry,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  async handleConnection(socket: Socket) {
    try {
      const token = (socket.handshake.auth?.token as string) ?? '';
      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, { secret: process.env.JWT_ACCESS_SECRET });
      const user = await this.access.loadUser(claims.tid, claims.sub);
      socket.data.user = user;
      await socket.join([room.tenant(user.tenantId), room.user(user.tenantId, user.userId)]);
    } catch {
      socket.emit('error', { message: 'unauthorized' });
      socket.disconnect(true);
    }
  }

  @SubscribeMessage('subscribe')
  async subscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: { entity: string }) {
    const user = socket.data.user as AppUser | undefined;
    if (!user || !body?.entity || !this.access.can(user, body.entity, 'read')) return { ok: false };
    await socket.join(room.entity(user.tenantId, body.entity));
    return { ok: true };
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: { entity: string }) {
    const user = socket.data.user as AppUser | undefined;
    if (user && body?.entity) await socket.leave(room.entity(user.tenantId, body.entity));
    return { ok: true };
  }

  // ── EventConsumer ──
  handles(type: string) {
    return type.startsWith('record.') || type === 'notification.created' || type.startsWith('workflow.') || type === 'metadata.published';
  }

  async handle(event: DomainEvent) {
    if (!this.server) return;
    const t = event.tenantId;

    if (event.type === 'notification.created') {
      const { userIds, ...payload } = event.data as { userIds: string[] };
      for (const u of userIds) this.server.to(room.user(t, u)).emit('notification', payload);
      return;
    }
    if (event.type === 'metadata.published') {
      this.server.to(room.tenant(t)).emit('metadata', event.data);
      return;
    }
    if (event.type.startsWith('workflow.')) {
      this.server.to(room.tenant(t)).emit('event', { type: event.type, entity: event.entity });
      return;
    }

    // record.<entity>.<verb>
    const [, entity, verb] = event.type.split('.');
    const after = (event.data as { after?: Record<string, unknown> | null }).after;
    const sockets = await this.server.in(room.entity(t, entity)).fetchSockets();
    for (const s of sockets) {
      const user = s.data.user as AppUser;
      const grants = this.access.grants(user, entity, 'read');
      const ownerId = String(after?.ownerId ?? '');
      if (!this.access.allowsRecord(user, grants, { ownerId, data: after ?? {} })) continue;
      const patch: LivePatch = {
        entity, id: event.entity!.id, version: 0, eventType: event.type,
        op: verb === 'deleted' ? 'delete' : 'upsert',
        data: after ? this.access.mask(user, entity, after) : undefined,
      };
      s.emit('patch', patch);
    }
    // Lightweight broadcast so dashboards/counters on other pages can refresh.
    this.server.to(room.tenant(t)).emit('event', { type: event.type, entity: event.entity });
  }
}

@Module({ providers: [RealtimeGateway] })
export class RealtimeModule {}
