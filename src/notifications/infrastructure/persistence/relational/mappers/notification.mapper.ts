import { Notification } from '../../../../domain/notification';
import { NotificationEntity } from '../entities/notification.entity';

export class NotificationMapper {
  static toDomain(entity: NotificationEntity): Notification {
    const dom = new Notification();
    dom.id = entity.id;
    dom.userId = entity.userId;
    dom.type = entity.type;
    dom.titleTranslations = entity.titleTranslations ?? {};
    dom.bodyTranslations = entity.bodyTranslations ?? {};
    dom.data = entity.data ?? {};
    dom.isRead = entity.isRead;
    dom.createdAt = entity.createdAt;
    dom.readAt = entity.readAt ?? null;
    return dom;
  }
}
