import { Inject, Injectable } from '@nestjs/common';
import IORedis from 'ioredis';

const ONLINE_SET = 'presence:online';
const sockSetKey = (userId: number): string => `presence:sockets:${userId}`;
// Sockets/online entries auto-expire after this many seconds in case
// disconnect handlers are missed (e.g. process crash). Heartbeat refreshes it.
const SOCKET_TTL_SECONDS = 60 * 60 * 2;

/**
 * Tracks online users via Redis SETs. Multi-socket aware:
 * a user is "online" so long as at least one of their sockets is connected.
 */
@Injectable()
export class ChatPresenceService {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: IORedis) {}

  /**
   * Register a new socket for the given user. Returns true if this is the
   * user's first connected socket (caller should broadcast online: true).
   */
  async addSocket(userId: number, socketId: string): Promise<boolean> {
    const key = sockSetKey(userId);
    const before = await this.redis.scard(key);
    await this.redis.sadd(key, socketId);
    await this.redis.expire(key, SOCKET_TTL_SECONDS);
    if (before === 0) {
      await this.redis.sadd(ONLINE_SET, String(userId));
      return true;
    }
    return false;
  }

  /**
   * Remove a socket. Returns true if this was the user's LAST socket
   * (caller should broadcast online: false).
   */
  async removeSocket(userId: number, socketId: string): Promise<boolean> {
    const key = sockSetKey(userId);
    await this.redis.srem(key, socketId);
    const remaining = await this.redis.scard(key);
    if (remaining === 0) {
      await this.redis.del(key);
      await this.redis.srem(ONLINE_SET, String(userId));
      return true;
    }
    return false;
  }

  async isOnline(userId: number): Promise<boolean> {
    const r = await this.redis.sismember(ONLINE_SET, String(userId));
    return r === 1;
  }

  async listOnline(userIds: number[]): Promise<Set<number>> {
    if (userIds.length === 0) return new Set();
    const pipe = this.redis.pipeline();
    for (const uid of userIds) {
      pipe.sismember(ONLINE_SET, String(uid));
    }
    const results = (await pipe.exec()) ?? [];
    const out = new Set<number>();
    results.forEach(([, val], idx) => {
      if (val === 1) out.add(userIds[idx]);
    });
    return out;
  }
}
