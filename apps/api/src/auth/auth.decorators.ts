import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { UserRole } from '@constack/shared-types';

export const IS_PUBLIC = 'constack:public';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  organizationId: string;
  role: UserRole;
  csrfToken: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser =>
    context.switchToHttp().getRequest<{ user: AuthenticatedUser }>().user,
);
