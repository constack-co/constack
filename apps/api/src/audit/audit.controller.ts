import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { CurrentUser, type AuthenticatedUser } from '../auth/auth.decorators.js';
import { Roles } from '../auth/roles.decorator.js';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles('administrator')
  list(@CurrentUser() user: AuthenticatedUser, @Query('limit') limit?: string) {
    return this.audit.list(user.organizationId, Number(limit ?? 200));
  }
}
