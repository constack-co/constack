import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';
import type { ActionPreviewRequest, ActionType } from '@constack/shared-types';
import { CurrentUser, type AuthenticatedUser } from '../auth/auth.decorators.js';
import { Roles } from '../auth/roles.decorator.js';
import { ActionsService } from './actions.service.js';

const actionTypes: ActionType[] = [
  'restart-pod',
  'delete-failed-pod',
  'rollout-restart-deployment',
  'rollout-restart-statefulset',
  'scale-deployment',
  'scale-statefulset',
  'retry-job',
  'suspend-cronjob',
  'resume-cronjob',
];

class ActionParametersDto {
  @IsOptional() @IsInt() @Min(0) @Max(10_000) replicas?: number;
}

class ActionPreviewDto {
  @IsIn(actionTypes) action!: ActionType;
  @IsString() resourceId!: string;
  @IsObject() parameters!: ActionParametersDto;
}

@Controller('actions')
@Roles('operator')
export class ActionsController {
  constructor(private readonly actions: ActionsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.actions.list(user.organizationId);
  }

  @Post('previews')
  preview(@CurrentUser() user: AuthenticatedUser, @Body() body: ActionPreviewDto) {
    return this.actions.preview(user.organizationId, user.id, body as ActionPreviewRequest);
  }

  @Post(':previewId/confirm')
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('previewId') previewId: string,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.actions.confirm(user.organizationId, user.id, previewId, idempotencyKey);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.actions.cancel(user, id);
  }
}
