import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { maybeContext } from '../context/request-context';
import { AccessService } from './access.service';
import { IS_PUBLIC, REQUIRED_PERMISSION } from './decorators';

export interface AccessTokenClaims {
  sub: string;
  tid: string;
  sid: string;
}

/** Global guard: verifies the JWT, loads the user into the request context, enforces @Can. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException();

    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, { secret: process.env.JWT_ACCESS_SECRET });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const ctx = maybeContext();
    if (!ctx) throw new UnauthorizedException('No request context');
    if (ctx.tenantId && ctx.tenantId !== claims.tid) throw new UnauthorizedException('Token is for another tenant');

    ctx.tenantId = claims.tid;
    ctx.user = await this.access.loadUser(claims.tid, claims.sub);
    ctx.actor = { type: 'user', id: claims.sub };

    const required = this.reflector.getAllAndOverride<{ resource: string; action: string }>(REQUIRED_PERMISSION, targets);
    if (required) this.access.assert(ctx.user, required.resource, required.action);
    return true;
  }
}
