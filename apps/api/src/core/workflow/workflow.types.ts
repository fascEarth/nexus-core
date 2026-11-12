import type { Condition } from '../common/conditions';

export interface WorkflowTaskSpec {
  /** Who gets the approval task when entering this state. */
  assignee?: 'manager' | 'owner';
  role?: string;
  dueHours?: number;
}

export interface WorkflowState {
  label: string;
  final?: boolean;
  task?: WorkflowTaskSpec;
}

export interface WorkflowTransition {
  name: string;
  label?: string;
  from: string | string[];
  to: string;
  /** Who may fire it. Omitted = anyone with `<entity>:update` on the record. */
  by?: { owner?: boolean; roles?: string[]; assignee?: boolean };
  /** Guard evaluated on { record, user }, e.g. amount limits. */
  condition?: Condition;
  requireComment?: boolean;
}

export interface WorkflowDefinition {
  initial: string;
  states: Record<string, WorkflowState>;
  transitions: WorkflowTransition[];
}
