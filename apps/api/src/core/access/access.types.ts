import type { SessionUser } from '@nexus/shared-types';

export interface AppUser extends SessionUser {
  tenantUserId: string;
  /** userIds of people reporting to this user (for `team` scope). */
  teamUserIds: string[];
}
