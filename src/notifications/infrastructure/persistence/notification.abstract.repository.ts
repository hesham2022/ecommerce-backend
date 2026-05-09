import { Notification } from '../../domain/notification';

export interface CreateNotificationInput {
  id: string;
  userId: number;
  type: string;
  titleTranslations: Record<string, string>;
  bodyTranslations: Record<string, string>;
  data: Record<string, unknown>;
}

export interface ListInboxOptions {
  userId: number;
  cursor?: string | null;
  limit: number;
  unreadOnly?: boolean;
}

export interface ListInboxResult {
  data: Notification[];
  nextCursor: string | null;
}

export abstract class NotificationAbstractRepository {
  abstract create(input: CreateNotificationInput): Promise<Notification>;
  abstract list(opts: ListInboxOptions): Promise<ListInboxResult>;
  abstract findOneForUser(
    id: string,
    userId: number,
  ): Promise<Notification | null>;
  abstract markRead(id: string, userId: number): Promise<Notification>;
  abstract markAllRead(userId: number): Promise<{ updated: number }>;
  abstract unreadCount(userId: number): Promise<number>;
}
