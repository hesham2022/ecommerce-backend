import { Inject, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import IORedis from 'ioredis';
import type { Server, Socket } from 'socket.io';
import { AllConfigType } from '../config/config.type';
import {
  extractTokenFromHandshake,
  validateHandshakeToken,
} from './realtime/chat-handshake.auth';
import { ChatPresenceService } from './realtime/chat-presence.service';
import {
  ChatRealtimeBus,
  MessageNewEvent,
  MessageReadEvent,
} from './realtime/chat-realtime.bus';
import { ChatService } from './chat.service';
import { ChatAbstractRepository } from './infrastructure/persistence/chat.abstract.repository';

interface AuthedSocket extends Socket {
  data: {
    userId: number;
    sessionId: number | string;
  };
}

const userRoom = (uid: number): string => `user:${uid}`;
const conversationRoom = (cid: string): string => `conversation:${cid}`;

@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class ChatGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit,
    OnModuleDestroy
{
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server!: Server;

  private busUnsubscribers: Array<() => void> = [];

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AllConfigType>,
    private readonly chat: ChatService,
    private readonly repo: ChatAbstractRepository,
    private readonly presence: ChatPresenceService,
    private readonly bus: ChatRealtimeBus,
    @Inject('REDIS_CLIENT') private readonly redis: IORedis,
  ) {
    void this.redis;
  }

  onModuleInit(): void {
    // Wire bus -> WS broadcasts. REST controllers emit on the bus,
    // and we fan out here. Single subscriber per gateway instance.
    this.busUnsubscribers.push(
      this.bus.onMessageNew((evt) => this.broadcastMessageNew(evt)),
      this.bus.onMessageRead((evt) => this.broadcastMessageRead(evt)),
    );
  }

  onModuleDestroy(): void {
    for (const off of this.busUnsubscribers) off();
    this.busUnsubscribers = [];
  }

  // ── Connection lifecycle ──────────────────────────────────────────

  async handleConnection(socket: Socket): Promise<void> {
    const secret = this.config.getOrThrow('auth.secret', { infer: true });
    const token = extractTokenFromHandshake({
      auth: socket.handshake.auth as { token?: unknown },
      headers: socket.handshake.headers as Record<string, unknown>,
    });
    const payload = await validateHandshakeToken(this.jwt, secret, token);
    if (!payload) {
      socket.emit('error', { reason: 'unauthorized' });
      socket.disconnect(true);
      return;
    }

    const authed = socket as AuthedSocket;
    authed.data.userId = payload.id;
    authed.data.sessionId = payload.sessionId;

    await authed.join(userRoom(payload.id));

    let firstSocket = false;
    try {
      firstSocket = await this.presence.addSocket(payload.id, socket.id);
    } catch (err) {
      this.logger.warn(`presence.addSocket failed: ${(err as Error).message}`);
    }

    if (firstSocket) {
      // Broadcast online state to this user's known counterparties.
      try {
        const counterparties = (await this.repo)
          ? await this.findCounterparties(payload.id)
          : [];
        for (const uid of counterparties) {
          this.server
            .to(userRoom(uid))
            .emit('presence:update', { userId: payload.id, isOnline: true });
        }
      } catch (err) {
        this.logger.warn(
          `presence broadcast failed: ${(err as Error).message}`,
        );
      }
    }
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    const authed = socket as AuthedSocket;
    const userId = authed.data?.userId;
    if (!userId) return;
    let lastSocket = false;
    try {
      lastSocket = await this.presence.removeSocket(userId, socket.id);
    } catch (err) {
      this.logger.warn(
        `presence.removeSocket failed: ${(err as Error).message}`,
      );
    }
    if (lastSocket) {
      const lastSeenAt = new Date().toISOString();
      try {
        const counterparties = await this.findCounterparties(userId);
        for (const uid of counterparties) {
          this.server.to(userRoom(uid)).emit('presence:update', {
            userId,
            isOnline: false,
            lastSeenAt,
          });
        }
      } catch (err) {
        this.logger.warn(
          `presence broadcast (offline) failed: ${(err as Error).message}`,
        );
      }
    }
  }

  // ── Client → Server ───────────────────────────────────────────────

  @SubscribeMessage('conversation:join')
  async onJoin(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: { id?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    const id = body?.id;
    if (!id) return { ok: false, error: 'id required' };
    const allowed = await this.assertParticipantSafe(id, socket.data.userId);
    if (!allowed) return { ok: false, error: 'forbidden' };
    await socket.join(conversationRoom(id));
    return { ok: true };
  }

  @SubscribeMessage('conversation:leave')
  async onLeave(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: { id?: string },
  ): Promise<{ ok: boolean }> {
    const id = body?.id;
    if (!id) return { ok: false };
    await socket.leave(conversationRoom(id));
    return { ok: true };
  }

  @SubscribeMessage('message:send')
  async onMessageSend(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody()
    body: {
      conversationId?: string;
      body?: string;
      attachmentFileIds?: string[];
    },
  ): Promise<{ ok: boolean; error?: string; messageId?: string }> {
    if (!body?.conversationId)
      return { ok: false, error: 'conversationId required' };
    try {
      // ChatService.sendMessage already emits on the bus, which fans out via
      // broadcastMessageNew in this gateway — single broadcast for both
      // REST and WS code paths.
      const msg = await this.chat.sendMessage(
        socket.data.userId,
        body.conversationId,
        { body: body.body, attachmentFileIds: body.attachmentFileIds },
      );
      return { ok: true, messageId: msg.id };
    } catch (err) {
      const e = err as { message?: string };
      return { ok: false, error: e?.message ?? 'send failed' };
    }
  }

  @SubscribeMessage('message:read')
  async onMessageRead(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody()
    body: { conversationId?: string; messageId?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    if (!body?.conversationId)
      return { ok: false, error: 'conversationId required' };
    try {
      // markRead emits on the bus internally — single broadcast point.
      await this.chat.markRead(
        socket.data.userId,
        body.conversationId,
        body.messageId,
      );
      return { ok: true };
    } catch (err) {
      const e = err as { message?: string };
      return { ok: false, error: e?.message ?? 'mark read failed' };
    }
  }

  @SubscribeMessage('typing:start')
  async onTypingStart(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: { conversationId?: string },
  ): Promise<void> {
    const cid = body?.conversationId;
    if (!cid) return;
    const allowed = await this.assertParticipantSafe(cid, socket.data.userId);
    if (!allowed) return;
    socket.to(conversationRoom(cid)).emit('typing:start', {
      conversationId: cid,
      userId: socket.data.userId,
    });
  }

  @SubscribeMessage('typing:stop')
  async onTypingStop(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: { conversationId?: string },
  ): Promise<void> {
    const cid = body?.conversationId;
    if (!cid) return;
    const allowed = await this.assertParticipantSafe(cid, socket.data.userId);
    if (!allowed) return;
    socket
      .to(conversationRoom(cid))
      .emit('typing:stop', { conversationId: cid, userId: socket.data.userId });
  }

  // ── Bus → broadcast ───────────────────────────────────────────────

  private broadcastMessageNew(evt: MessageNewEvent): void {
    this.server
      .to(conversationRoom(evt.conversationId))
      .emit('message:new', evt.message);
    // conversation:updated → user rooms (so the inbox list refreshes)
    for (const uid of evt.recipientUserIds) {
      this.server.to(userRoom(uid)).emit('conversation:updated', {
        conversationId: evt.conversationId,
        lastMessageAt: evt.message.createdAt,
      });
    }
  }

  private broadcastMessageRead(evt: MessageReadEvent): void {
    this.server.to(conversationRoom(evt.conversationId)).emit('message:read', {
      conversationId: evt.conversationId,
      userId: evt.userId,
      messageId: evt.messageId,
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────

  /**
   * Pure-ish: returns true if userId is a participant in conversationId.
   * Exported for unit testing via a thin wrapper.
   */
  async assertParticipantSafe(
    conversationId: string,
    userId: number,
  ): Promise<boolean> {
    const part = await this.repo.findParticipant(conversationId, userId);
    return !!part;
  }

  /**
   * For a given user, list the OTHER user-ids they share a conversation with.
   * Used to fan out presence updates only to relevant peers (no global echo).
   */
  private async findCounterparties(userId: number): Promise<number[]> {
    // Lean implementation: scan listConversationsForUser for default unarchived.
    const items = await this.repo.listConversationsForUser({
      userId,
      archived: false,
      cursor: null,
      limit: 100,
    });
    const ids = new Set<number>();
    for (const it of items) {
      if (it.counterpartyUserId > 0 && it.counterpartyUserId !== userId) {
        ids.add(it.counterpartyUserId);
      }
    }
    return Array.from(ids);
  }
}
