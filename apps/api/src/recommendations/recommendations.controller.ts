import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser, type AuthenticatedUser } from '../auth/auth.decorators.js';
import { Roles } from '../auth/roles.decorator.js';
import { RecommendationsService } from './recommendations.service.js';

class AnalyzeDto {
  @IsString() resourceId!: string;
  @IsBoolean() includeEvents!: boolean;
  @IsBoolean() includeMetrics!: boolean;
}

class FeedbackDto {
  @IsBoolean() helpful!: boolean;
  @IsOptional() @IsString() @MaxLength(2_000) comment?: string;
}

@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('resourceId') resourceId?: string) {
    return this.recommendations.list(user.organizationId, resourceId);
  }

  @Post('analyze')
  @Roles('operator')
  analyze(@CurrentUser() user: AuthenticatedUser, @Body() body: AnalyzeDto) {
    return this.recommendations.request(
      user.organizationId,
      body.resourceId,
      body.includeEvents,
      body.includeMetrics,
    );
  }

  @Post(':id/feedback')
  feedback(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: FeedbackDto,
  ) {
    return this.recommendations.feedback(user.organizationId, id, body.helpful, body.comment);
  }
}
