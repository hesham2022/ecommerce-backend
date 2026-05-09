import { INestApplicationContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import IORedis from 'ioredis';
import type { ServerOptions } from 'socket.io';
import { AllConfigType } from '../../config/config.type';

/**
 * Socket.IO IoAdapter that wires a Redis pub/sub backplane so that
 * many API instances can fan out events to all sockets.
 *
 * Disable via env CHAT_REDIS_ADAPTER=false for single-instance dev/CI.
 */
export class ChatRedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(ChatRedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter> | undefined;
  private pubClient?: IORedis;
  private subClient?: IORedis;

  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const config = this.app.get(ConfigService<AllConfigType>);
    const enabled =
      (process.env.CHAT_REDIS_ADAPTER ?? 'true').toLowerCase() !== 'false';
    if (!enabled) {
      this.logger.log('CHAT_REDIS_ADAPTER=false — using in-memory adapter');
      return;
    }
    const host = config.getOrThrow('redis.host', { infer: true });
    const port = config.getOrThrow('redis.port', { infer: true });
    this.pubClient = new IORedis({ host, port, maxRetriesPerRequest: null });
    this.subClient = this.pubClient.duplicate();
    // Wait for both clients to be ready before installing.
    await Promise.all([
      new Promise<void>((res) => this.pubClient!.once('ready', () => res())),
      new Promise<void>((res) => this.subClient!.once('ready', () => res())),
    ]);
    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
    this.logger.log('Socket.IO Redis adapter connected');
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      (server as { adapter: (a: unknown) => void }).adapter(
        this.adapterConstructor,
      );
    }
    return server;
  }
}
