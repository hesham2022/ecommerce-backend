import { Injectable } from '@nestjs/common';
import { uuidv7Generate } from '../utils/uuid';
import { Notification } from './domain/notification';
import {
  ListInboxOptions,
  ListInboxResult,
  NotificationAbstractRepository,
} from './infrastructure/persistence/notification.abstract.repository';

@Injectable()
export class NotificationsService {
  constructor(private readonly repo: NotificationAbstractRepository) {}

  /**
   * Persist an in-app notification. Other modules call this to drop a row
   * into the user's inbox. FCM push fan-out is owned by phase-7-chat-push.
   */
  create(
    userId: number,
    type: string,
    titleTranslations: Record<string, string>,
    bodyTranslations: Record<string, string>,
    data: Record<string, unknown> = {},
  ): Promise<Notification> {
    return this.repo.create({
      id: uuidv7Generate(),
      userId,
      type,
      titleTranslations,
      bodyTranslations,
      data,
    });
  }

  list(opts: ListInboxOptions): Promise<ListInboxResult> {
    return this.repo.list(opts);
  }

  markRead(id: string, userId: number): Promise<Notification> {
    return this.repo.markRead(id, userId);
  }

  markAllRead(userId: number): Promise<{ updated: number }> {
    return this.repo.markAllRead(userId);
  }

  unreadCount(userId: number): Promise<number> {
    return this.repo.unreadCount(userId);
  }
}
