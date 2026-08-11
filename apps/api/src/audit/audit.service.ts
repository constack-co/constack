import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../persistence/entities.js';

export interface AuditEvent {
  organizationId: string;
  actorUserId?: string;
  eventType: string;
  targetId?: string;
  outcome: 'allowed' | 'denied' | 'queued' | 'succeeded' | 'failed' | 'cancelled';
  details?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditLog) private readonly repository: Repository<AuditLog>) {}

  async record(event: AuditEvent): Promise<void> {
    await this.repository.save(
      this.repository.create({
        organizationId: event.organizationId,
        actorUserId: event.actorUserId ?? null,
        eventType: event.eventType,
        targetId: event.targetId ?? null,
        outcome: event.outcome,
        details: event.details ?? {},
      }),
    );
  }

  list(organizationId: string, limit = 200): Promise<AuditLog[]> {
    return this.repository.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
      take: Math.min(500, Math.max(1, limit)),
    });
  }
}
