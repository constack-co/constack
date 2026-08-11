import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from './auth.decorators.js';
import { REQUIRED_ROLES } from './roles.decorator.js';
import type { UserRole } from '@constack/shared-types';

const rank: Record<UserRole, number> = { viewer: 0, operator: 1, administrator: 2 };

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    const minimum = Math.min(...required.map((role) => rank[role]));
    if (!user || rank[user.role] < minimum) throw new ForbiddenException('Insufficient role');
    return true;
  }
}
