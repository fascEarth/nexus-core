---
name: new-event-consumer
description: React to platform events from another module, e.g. "when leave is approved, mark attendance". Use whenever one module must respond to something that happens in another.
---
# Add an event consumer

Template (`apps/api/src/modules/<module>/<name>.consumer.ts`):
```ts
@Injectable()
export class AttendanceOnLeaveApproved implements EventConsumer, OnModuleInit {
  readonly consumerName = 'attendance.on-leave-approved'; // stable forever
  constructor(private registry: ConsumerRegistry, private prisma: PrismaService, private events: EventBus, private audit: AuditService) {}
  onModuleInit() { this.registry.register(this); }
  handles(type: string) { return type === 'workflow.leave-approval.approve' || type === 'workflow.leave-approval.hr_approve'; }
  async handle(event: DomainEvent) {
    await this.prisma.tx(async (tx) => {
      // 1. do the work (tenant already set from event)
      // 2. audit
      // 3. emit follow-up event if others may care
    });
  }
}
```
Rules:
- Idempotent: the runner dedupes by event id, but make writes upserts where possible.
- Never call slow external APIs inside the tx; emit an event and handle it in a separate consumer.
- Add the provider to its module; add a unit test for `handles()` and the core logic.
- Failures retry 3× then land in `dead_letter` (replay: `POST /api/v1/events/dead-letters/:id/replay`).
