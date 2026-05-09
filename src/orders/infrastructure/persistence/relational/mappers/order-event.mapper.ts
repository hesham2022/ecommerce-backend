import { OrderEvent } from '../../../../domain/order-event';
import { OrderEventEntity } from '../entities/order-event.entity';

export class OrderEventMapper {
  static toDomain(entity: OrderEventEntity): OrderEvent {
    const d = new OrderEvent();
    d.id = entity.id;
    d.subOrderId = entity.subOrderId;
    d.eventType = entity.eventType;
    d.fromStatus = entity.fromStatus ?? null;
    d.toStatus = entity.toStatus ?? null;
    d.actorUserId = entity.actorUserId ?? null;
    d.payload = entity.payload ?? null;
    d.createdAt = entity.createdAt;
    return d;
  }
}
