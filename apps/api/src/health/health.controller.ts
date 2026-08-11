import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RedisService } from '../common/redis.service.js';
import { Public } from '../auth/auth.decorators.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
  ) {}

  @Get('live')
  @Public()
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @Public()
  async ready() {
    await this.dataSource.query('SELECT 1');
    await this.redis.client.ping();
    return { status: 'ready' };
  }
}
