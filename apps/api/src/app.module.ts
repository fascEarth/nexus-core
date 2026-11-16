import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './core/prisma/prisma.module';
import { AccessModule } from './core/access/access.module';
import { AuthModule } from './core/auth/auth.module';
import { EventsModule } from './core/events/events.module';
import { AuditModule } from './core/audit/audit.service';
import { NotifyModule } from './core/notify/notification.service';
import { WorkflowModule } from './core/workflow/workflow.module';
import { MetadataModule } from './core/metadata/metadata.module';
import { RulesModule } from './core/rules/rules.controller';
import { RealtimeModule } from './core/realtime/realtime.gateway';
import { HealthModule } from './core/health/health.controller';
import { InsightsModule } from './core/insights/insights.module';
import { FoodModule } from './modules/food/food.module';
import { TenantMiddleware } from './core/tenancy/tenant.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule,
    AccessModule,
    EventsModule,
    AuditModule,
    NotifyModule,
    AuthModule,
    WorkflowModule,
    MetadataModule,
    RulesModule,
    RealtimeModule,
    HealthModule,
    InsightsModule,
    // Business modules plug in here: they only emit and consume events.
    FoodModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*path');
  }
}
