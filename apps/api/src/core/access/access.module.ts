import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AccessService } from './access.service';
import { AuthGuard } from './auth.guard';

@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [AccessService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AccessService, JwtModule],
})
export class AccessModule {}
