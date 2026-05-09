import { Payment } from '../../../../domain/payment';
import { PaymentEntity } from '../entities/payment.entity';

export class PaymentMapper {
  static toDomain(entity: PaymentEntity): Payment {
    const dom = new Payment();
    dom.id = entity.id;
    dom.orderId = entity.orderId;
    dom.provider = entity.provider;
    dom.providerIntentId = entity.providerIntentId;
    dom.clientSecret = entity.clientSecret ?? null;
    dom.status = entity.status;
    dom.amountMinor = entity.amountMinor;
    dom.currencyCode = entity.currencyCode;
    dom.lastError = entity.lastError ?? null;
    dom.metadata = entity.metadata ?? {};
    dom.createdAt = entity.createdAt;
    dom.updatedAt = entity.updatedAt;
    return dom;
  }
}
