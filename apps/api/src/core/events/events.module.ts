import { Global, Module } from '@nestjs/common';
import { ConsumerRegistry, ConsumerRunner } from './consumer-runner.service';
import { EventBus } from './event-bus.service';
import { EventsController } from './events.controller';
import { OutboxRelay } from './outbox-relay.service';

@Global()
@Module({
  controllers: [EventsController],
  providers: [EventBus, OutboxRelay, ConsumerRegistry, ConsumerRunner],
  exports: [EventBus, ConsumerRegistry],
})
export class EventsModule {}
