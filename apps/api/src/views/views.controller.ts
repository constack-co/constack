import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsIn, IsObject, IsString, MaxLength } from 'class-validator';
import { Repository } from 'typeorm';
import { CurrentUser, type AuthenticatedUser } from '../auth/auth.decorators.js';
import { SavedView } from '../persistence/entities.js';

class SaveViewDto {
  @IsString() @MaxLength(200) name!: string;
  @IsIn(['cluster', 'namespace', 'application', 'service', 'node', 'incident', 'trace'])
  layoutMode!: string;
  @IsObject() state!: Record<string, unknown>;
}

@Controller('views')
export class ViewsController {
  constructor(@InjectRepository(SavedView) private readonly views: Repository<SavedView>) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.views.find({
      where: { organizationId: user.organizationId, userId: user.id },
      order: { updatedAt: 'DESC' },
    });
  }

  @Post()
  save(@CurrentUser() user: AuthenticatedUser, @Body() body: SaveViewDto) {
    return this.views.save(
      this.views.create({
        organizationId: user.organizationId,
        userId: user.id,
        name: body.name,
        layoutMode: body.layoutMode,
        state: body.state,
      }),
    );
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    await this.views.delete({ id, organizationId: user.organizationId, userId: user.id });
    return { ok: true };
  }
}
