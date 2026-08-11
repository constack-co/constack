import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { UserRole } from '@constack/shared-types';
import { CurrentUser, type AuthenticatedUser } from '../auth/auth.decorators.js';
import { Roles } from '../auth/roles.decorator.js';
import { ManagementService } from './management.service.js';

const roles: UserRole[] = ['viewer', 'operator', 'administrator'];

class CreateUserDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(1) @MaxLength(200) displayName!: string;
  @IsOptional() @IsString() @MinLength(12) @MaxLength(200) password?: string;
  @IsIn(roles) role!: UserRole;
}

class UpdateUserDto {
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsIn(roles) role?: UserRole;
}

class CreateIntegrationDto {
  @IsString() @MaxLength(100) type!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsBoolean() enabled!: boolean;
  @IsObject() configuration!: Record<string, unknown>;
}

class UpdateIntegrationDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsObject() configuration?: Record<string, unknown>;
}

class CreateIncidentDto {
  @IsString() @MaxLength(500) title!: string;
  @IsIn(['info', 'warning', 'critical']) severity!: string;
  @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) resourceIds!: string[];
}

class UpdateIncidentDto {
  @IsOptional() @IsString() @MaxLength(500) title?: string;
  @IsOptional() @IsIn(['info', 'warning', 'critical']) severity?: string;
  @IsOptional() @IsIn(['open', 'investigating', 'resolved']) status?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) resourceIds?: string[];
}

class PreferenceDto {
  @Allow()
  value!: unknown;
}

@Controller('users')
@Roles('administrator')
export class UsersController {
  constructor(private readonly management: ManagementService) {}
  @Get() list(@CurrentUser() user: AuthenticatedUser) {
    return this.management.users(user.organizationId);
  }
  @Post() create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateUserDto) {
    return this.management.createUser(user, body);
  }
  @Patch(':id') update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateUserDto,
  ) {
    return this.management.updateUser(user, id, body);
  }
}

@Controller('clusters')
export class ClustersController {
  constructor(private readonly management: ManagementService) {}
  @Get() list(@CurrentUser() user: AuthenticatedUser) {
    return this.management.clusters(user.organizationId);
  }
}

@Controller('integrations')
@Roles('administrator')
export class IntegrationsController {
  constructor(private readonly management: ManagementService) {}
  @Get() list(@CurrentUser() user: AuthenticatedUser) {
    return this.management.integrations(user.organizationId);
  }
  @Post() create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateIntegrationDto) {
    return this.management.createIntegration(user, body);
  }
  @Patch(':id') update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateIntegrationDto,
  ) {
    return this.management.updateIntegration(user, id, body);
  }
}

@Controller('incidents')
export class IncidentsController {
  constructor(private readonly management: ManagementService) {}
  @Get() list(@CurrentUser() user: AuthenticatedUser) {
    return this.management.incidents(user.organizationId);
  }
  @Post() @Roles('operator') create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateIncidentDto,
  ) {
    return this.management.createIncident(user, body);
  }
  @Patch(':id') @Roles('operator') update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateIncidentDto,
  ) {
    return this.management.updateIncident(user, id, body);
  }
}

@Controller('preferences')
export class PreferencesController {
  constructor(private readonly management: ManagementService) {}
  @Get(':key') get(@CurrentUser() user: AuthenticatedUser, @Param('key') key: string) {
    return this.management.preference(user.id, key);
  }
  @Put(':key') put(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
    @Body() body: PreferenceDto,
  ) {
    return this.management.savePreference(user.id, key, body.value);
  }
}

@Controller('events')
export class EventsController {
  constructor(private readonly management: ManagementService) {}
  @Get() list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.management.events(user.organizationId, limit);
  }
}
