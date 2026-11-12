import { Controller, Get, Module } from '@nestjs/common';
import { Public } from '../access/decorators';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    const db = await this.prisma.system.$queryRaw`SELECT 1`.then(() => 'up').catch(() => 'down');
    const pending = await this.prisma.system.outboxEvent.count({ where: { publishedAt: null } }).catch(() => -1);
    return { status: db === 'up' ? 'ok' : 'degraded', db, outboxPending: pending, time: new Date().toISOString() };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
