import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'nexus:isPublic';
export const REQUIRED_PERMISSION = 'nexus:permission';

/** Skip authentication (login, signup, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Require `<resource>:<action>`, e.g. @Can('rules', 'update'). */
export const Can = (resource: string, action: string) => SetMetadata(REQUIRED_PERMISSION, { resource, action });
