import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC, type AuthenticatedUser } from './auth.decorators.js';
import { AuthService } from './auth.service.js';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) this.assertSameOrigin(request);
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const sessionId = request.cookies?.constack_session as string | undefined;
    if (!sessionId) throw new UnauthorizedException('Authentication required');
    const user = await this.auth.getSession(sessionId);
    if (!user) throw new UnauthorizedException('Session expired');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const token = request.header('x-csrf-token');
      if (!token || token !== user.csrfToken) throw new ForbiddenException('Invalid CSRF token');
    }
    request.user = user;
    return true;
  }

  private assertSameOrigin(request: Request): void {
    const host = (request.header('x-forwarded-host') ?? request.header('host'))
      ?.split(',')[0]
      ?.trim();
    const source = request.header('origin') ?? request.header('referer');
    if (!host || !source)
      throw new ForbiddenException('A same-origin mutation request is required');
    try {
      if (new URL(source).host !== host)
        throw new ForbiddenException('Cross-origin mutations are not allowed');
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new ForbiddenException('Mutation origin is invalid');
    }
  }
}
