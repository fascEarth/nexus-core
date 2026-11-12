import { Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { runInContext } from '../context/request-context';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Resolves the tenant from (in order): `X-Tenant` header, subdomain of ROOT_DOMAIN.
 * The JWT claim is checked against it later in AuthGuard.
 * Wraps the rest of the request in a fresh RequestContext.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private cache = new Map<string, { id: string | null; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const slug = this.slugFrom(req);
    let tenantId: string | undefined;

    if (slug) {
      tenantId = (await this.lookup(slug)) ?? undefined;
      if (!tenantId) return next(new NotFoundException(`Unknown tenant "${slug}"`));
    }

    const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();
    runInContext({ tenantId, correlationId, ip: req.ip }, () => next());
  }

  private slugFrom(req: Request): string | undefined {
    const header = req.headers['x-tenant'];
    if (typeof header === 'string' && header) return header.toLowerCase();
    const root = process.env.ROOT_DOMAIN;
    const host = req.hostname;
    if (root && host.endsWith(`.${root}`)) return host.slice(0, -(root.length + 1)).split('.').pop();
    return undefined;
  }

  private async lookup(slug: string): Promise<string | null> {
    const hit = this.cache.get(slug);
    if (hit && Date.now() - hit.at < 60_000) return hit.id;
    const tenant = await this.prisma.system.tenant.findUnique({ where: { slug }, select: { id: true, active: true } });
    const id = tenant?.active ? tenant.id : null;
    this.cache.set(slug, { id, at: Date.now() });
    return id;
  }
}
