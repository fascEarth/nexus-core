/**
 * Contracts shared by the API, workers and the Angular web app.
 * Changing an event shape? Bump its `version` and keep the old handler until all consumers migrate.
 */

export type ActorType = 'user' | 'system' | 'rule' | 'workflow' | 'ai';

export interface EventActor {
  type: ActorType;
  id: string;
  /** For AI actions: the human who asked. */
  onBehalfOf?: string;
}

export interface DomainEvent<T = Record<string, unknown>> {
  id: string;
  /** `<module>.<entity>.<verb>` e.g. `hrms.leave.approved` */
  type: string;
  version: number;
  tenantId: string;
  actor: EventActor;
  entity?: { name: string; id: string };
  data: T;
  /** Id of the originating request; follows the whole ripple. */
  correlationId: string;
  /** Id of the event that caused this one (rules / workflows). */
  causationId?: string;
  /** Depth of the causation chain. Loop guard stops at MAX_CAUSATION_DEPTH. */
  depth: number;
  occurredAt: string;
}

export const MAX_CAUSATION_DEPTH = 8;

export interface RecordChange {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/** Record scope on a role permission. */
export type PermissionScope = 'own' | 'team' | 'org_unit' | 'all';

export type CrudAction = 'create' | 'read' | 'update' | 'delete' | 'export' | 'approve';

/** `<resource>:<action>` e.g. `leave:approve`, `*:read` */
export type PermissionKey = `${string}:${string}`;

export interface CompiledPermission {
  key: PermissionKey;
  scope: PermissionScope;
  /** json-rules-engine style condition evaluated against the record (ABAC). */
  condition?: unknown;
}

export interface FieldMask {
  /** entity -> field -> mode */
  [entity: string]: Record<string, 'hidden' | 'read' | 'write'>;
}

export interface SessionUser {
  userId: string;
  tenantId: string;
  email: string;
  name: string;
  roles: string[];
  permissions: CompiledPermission[];
  fieldMask: FieldMask;
  orgUnitIds: string[];
}

/** Realtime patch pushed over WebSocket. */
export interface LivePatch {
  entity: string;
  id: string;
  version: number;
  op: 'upsert' | 'delete';
  data?: Record<string, unknown>;
  eventType: string;
}

export type FieldType =
  | 'text' | 'textarea' | 'number' | 'money' | 'date' | 'datetime' | 'boolean'
  | 'select' | 'multiselect' | 'lookup' | 'email' | 'phone' | 'file' | 'json';

export interface FieldDefinition {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  lookupEntity?: string;
  defaultValue?: unknown;
  pii?: boolean;
  order?: number;
}

export interface EntityDefinition {
  name: string;
  label: string;
  pluralLabel: string;
  icon?: string;
  numbering?: string;
  workflowKey?: string;
  fields: FieldDefinition[];
}
