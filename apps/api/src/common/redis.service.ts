import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { loadRuntimeConfig } from '@constack/config';

@Injectable()
export class RedisService implements OnApplicationShutdown {
  readonly client: Redis;

  constructor() {
    this.client = new Redis(loadRuntimeConfig().REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
    });
  }

  duplicate(): Redis {
    return this.client.duplicate();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.quit();
  }
}
