import { OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { RedisService } from '../common/redis.service.js';
import { AuthService } from '../auth/auth.service.js';
import { TopologyService } from '../topology/topology.service.js';

@WebSocketGateway({ namespace: '/realtime', transports: ['websocket'], cors: { origin: false } })
export class RealtimeGateway implements OnGatewayConnection, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private readonly subscriber;

  constructor(
    redis: RedisService,
    private readonly auth: AuthService,
    private readonly topology: TopologyService,
  ) {
    this.subscriber = redis.duplicate();
    void this.subscriber.subscribe('constack:realtime');
    this.subscriber.on('message', (_channel, message) => {
      try {
        const envelope = JSON.parse(message) as {
          clusterId?: string;
          event?: string;
          payload?: unknown;
        };
        if (envelope.clusterId && envelope.event)
          this.server?.to(`cluster:${envelope.clusterId}`).emit(envelope.event, envelope.payload);
      } catch {
        /* Invalid internal events are ignored rather than forwarded. */
      }
    });
  }

  async handleConnection(socket: Socket): Promise<void> {
    const origin = socket.handshake.headers.origin;
    const host = socket.handshake.headers.host;
    if (origin && host && new URL(origin).host !== host) {
      socket.disconnect(true);
      return;
    }
    const cookie = socket.handshake.headers.cookie ?? '';
    const sessionId = cookie
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith('constack_session='))
      ?.split('=')[1];
    const user = sessionId ? await this.auth.getSession(sessionId) : undefined;
    if (!user) {
      socket.disconnect(true);
      return;
    }
    socket.data.user = user;
  }

  @SubscribeMessage('subscribe')
  async subscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { clusterId: string; lastSequence?: number },
  ) {
    if (!socket.data.user || typeof body?.clusterId !== 'string') return { ok: false };
    const snapshot = await this.topology.snapshot();
    if (body.clusterId !== snapshot.clusterId) return { ok: false };
    await socket.join(`cluster:${body.clusterId}`);
    if (body.lastSequence !== snapshot.sequence) {
      socket.emit('resync.required', {
        schemaVersion: snapshot.schemaVersion,
        clusterId: snapshot.clusterId,
        sequence: snapshot.sequence,
        occurredAt: new Date().toISOString(),
        reason: 'The client sequence does not match the current topology sequence.',
      });
      socket.emit('topology.snapshot', snapshot);
    }
    return { ok: true, sequence: snapshot.sequence };
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber.quit();
  }
}
