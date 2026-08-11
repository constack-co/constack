import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SavedView } from '../persistence/entities.js';
import { ViewsController } from './views.controller.js';

@Module({ imports: [TypeOrmModule.forFeature([SavedView])], controllers: [ViewsController] })
export class ViewsModule {}
