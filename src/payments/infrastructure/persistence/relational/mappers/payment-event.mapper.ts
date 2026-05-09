import { PaymentEvent } from '../../../../domain/payment-event';
import { PaymentEventEntity } from '../entities/payment-event.entity';

export class PaymentEventMapper {
  static toDomain(entity: PaymentEventEntity): PaymentEvent {
    const dom = new PaymentEvent();
    dom.id = entity.id;
    dom.paymentId = entity.paymentId;
    dom.provider = entity.provider;
    dom.providerEventId = entity.providerEventId;
    dom.eventType = entity.eventType;
    dom.payload = entity.payload ?? {};
    dom.receivedAt = entity.receivedAt;
    return dom;
  }
}
