import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@constack/shared-types';

export const REQUIRED_ROLES = 'constack:roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(REQUIRED_ROLES, roles);
