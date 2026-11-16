import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { runInContext } from '../context/request-context';
import { EventBus } from '../events/event-bus.service';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tenant: { id: string; slug: string; name: string };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly access: AccessService,
    private readonly events: EventBus,
  ) {}

  /** Self-service signup: new tenant + owner user with the admin role. */
  async signup(input: { tenantName: string; slug: string; name: string; email: string; password: string }, meta: SessionMeta) {
    const slug = input.slug.toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{2,30}$/.test(slug)) throw new BadRequestException('Slug: 3–31 chars, a-z 0-9 and dashes');
    if (await this.prisma.system.tenant.findUnique({ where: { slug } })) throw new ConflictException('Workspace name taken');

    const email = input.email.toLowerCase();
    const existing = await this.prisma.system.user.findUnique({ where: { email } });
    // An existing account may create another workspace only with its own password.
    if (existing && !(existing.passwordHash && (await argon2.verify(existing.passwordHash, input.password)))) {
      throw new ConflictException('Email already registered. Use your existing password.');
    }
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

    const tenant = await this.prisma.system.tenant.create({ data: { slug, name: input.tenantName } });
    const user = existing ?? (await this.prisma.system.user.create({ data: { email, name: input.name, passwordHash } }));

    await runInContext({ tenantId: tenant.id, actor: { type: 'user', id: user.id } }, () =>
      this.prisma.tx(async (tx) => {
        const role = await tx.role.create({
          data: { tenantId: tenant.id, key: 'admin', name: 'Administrator', system: true,
            permissions: { create: [{ tenantId: tenant.id, permission: '*:*', scope: 'all' }] } },
        });
        await tx.role.create({
          data: { tenantId: tenant.id, key: 'member', name: 'Member', system: true,
            permissions: { create: [{ tenantId: tenant.id, permission: '*:read', scope: 'own' }, { tenantId: tenant.id, permission: '*:create', scope: 'own' }] } },
        });
        const membership = await tx.tenantUser.create({ data: { tenantId: tenant.id, userId: user.id } });
        await tx.userRole.create({ data: { tenantId: tenant.id, tenantUserId: membership.id, roleId: role.id } });
        await this.events.emit(tx, { type: 'platform.tenant.created', data: { tenantId: tenant.id, slug } });
      }, tenant.id),
    );

    return this.issue(user.id, tenant, meta);
  }

  async login(input: { tenant: string; email: string; password: string }, meta: SessionMeta): Promise<TokenPair> {
    const tenant = await this.prisma.system.tenant.findUnique({ where: { slug: input.tenant.toLowerCase() } });
    const user = await this.prisma.system.user.findUnique({ where: { email: input.email.toLowerCase() } });
    // Same error for every failure: never reveal which part was wrong.
    const fail = () => new UnauthorizedException('Invalid workspace, email or password');
    if (!tenant?.active || !user?.passwordHash) throw fail();
    if (!(await argon2.verify(user.passwordHash, input.password))) throw fail();

    await this.access.loadUser(tenant.id, user.id).catch(() => { throw fail(); });
    await this.prisma.system.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issue(user.id, tenant, meta);
  }

  async refresh(refreshToken: string, meta: SessionMeta): Promise<TokenPair> {
    const [sid, secret] = (refreshToken ?? '').split('.');
    if (!sid || !secret) throw new UnauthorizedException();
    const session = await this.prisma.system.session.findUnique({ where: { id: sid } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) throw new UnauthorizedException();
    if (session.refreshTokenHash !== sha256(secret)) {
      // Reuse of an old refresh token: likely stolen. Kill the session.
      await this.prisma.system.session.update({ where: { id: sid }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    await this.prisma.system.session.update({ where: { id: sid }, data: { revokedAt: new Date() } });
    const tenant = await this.prisma.system.tenant.findUniqueOrThrow({ where: { id: session.tenantId } });
    return this.issue(session.userId, tenant, meta);
  }

  async logout(refreshToken: string) {
    const [sid] = (refreshToken ?? '').split('.');
    if (sid) await this.prisma.system.session.updateMany({ where: { id: sid, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async issue(userId: string, tenant: { id: string; slug: string; name: string }, meta: SessionMeta): Promise<TokenPair> {
    const secret = randomBytes(48).toString('hex');
    const days = Number(process.env.JWT_REFRESH_TTL_DAYS ?? 14);
    const session = await this.prisma.system.session.create({
      data: {
        userId, tenantId: tenant.id, refreshTokenHash: sha256(secret),
        userAgent: meta.userAgent?.slice(0, 255), ip: meta.ip,
        expiresAt: new Date(Date.now() + days * 86_400_000),
      },
    });
    const accessToken = await this.jwt.signAsync(
      { sub: userId, tid: tenant.id, sid: session.id },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: (process.env.JWT_ACCESS_TTL ?? '15m') as never },
    );
    return { accessToken, refreshToken: `${session.id}.${secret}`, tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name } };
  }
}

export interface SessionMeta {
  ip?: string;
  userAgent?: string;
}
