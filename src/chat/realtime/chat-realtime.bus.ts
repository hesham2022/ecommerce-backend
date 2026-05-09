import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';
import { Message } from '../domain/message';

/**
 * Lightweight pub/sub bus that decouples the REST controllers
 * (which call ChatService) from the Socket.IO gateway.
 *
 * REST -> ChatService.sendMessage() -> bus.emit('message:new', ...)
 *      -> ChatGateway listens and broadcasts to conversation:<id>.
 *
 * Keeping this outside the gateway avoids a circular dep
 * (gateway depends on service, service can't depend on gateway).
 */
export interface MessageNewEvent {
  conversationId: string;
  message: Message;
  recipientUserIds: number[];
}

export interface MessageReadEvent {
  conversationId: string;
  userId: number;
  messageId: string | null;
}

@Injectable()
export class ChatRealtimeBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Bumping max listeners — single gateway instance subscribes,
    // but tests may attach extras.
    this.emitter.setMaxListeners(50);
  }

  emitMessageNew(evt: MessageNewEvent): void {
    this.emitter.emit('message:new', evt);
  }

  onMessageNew(listener: (evt: MessageNewEvent) => void): () => void {
    this.emitter.on('message:new', listener);
    return () => this.emitter.off('message:new', listener);
  }

  emitMessageRead(evt: MessageReadEvent): void {
    this.emitter.emit('message:read', evt);
  }

  onMessageRead(listener: (evt: MessageReadEvent) => void): () => void {
    this.emitter.on('message:read', listener);
    return () => this.emitter.off('message:read', listener);
  }
}
