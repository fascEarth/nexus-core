import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { Public } from '../access/decorators';
import { currentUser } from '../context/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from './auth.service';

const password = z.string().min(10, 'Min 10 characters').max(128)
  .regex(/[A-Z]/, 'Needs an uppercase letter').regex(/[a-z]/, 'Needs a lowercase letter').regex(/\d/, 'Needs a number');

const SignupDto = z.object({
  tenantName: z.string().min(2).max(80),
  slug: z.string().min(3).max(31),
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password,
});
const LoginDto = z.object({ tenant: z.string().min(1), email: z.string().email(), password: z.string().min(1).max(128) });
const RefreshDto = z.object({ refreshToken: z.string().min(10) });

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('signup')
  signup(@Body(new ZodPipe(SignupDto)) body: z.infer<typeof SignupDto>, @Req() req: Request) {
    return this.auth.signup(body, meta(req));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body(new ZodPipe(LoginDto)) body: z.infer<typeof LoginDto>, @Req() req: Request) {
    return this.auth.login(body, meta(req));
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body(new ZodPipe(RefreshDto)) body: z.infer<typeof RefreshDto>, @Req() req: Request) {
    return this.auth.refresh(body.refreshToken, meta(req));
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(@Body(new ZodPipe(RefreshDto)) body: z.infer<typeof RefreshDto>) {
    await this.auth.logout(body.refreshToken);
  }

  /** Current user with compiled permissions and field masks, used by the Angular shell. */
  @Get('me')
  me() {
    const u = currentUser();
    return { userId: u.userId, tenantId: u.tenantId, email: u.email, name: u.name, roles: u.roles, permissions: u.permissions, fieldMask: u.fieldMask };
  }
}
