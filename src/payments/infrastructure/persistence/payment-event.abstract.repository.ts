import { PaymentEvent } from '../../domain/payment-event';
import { PaymentProviderName } from '../../domain/payment-enums';

export interface RecordPaymentEventInput {
  id: string;
  paymentId: string;
  provider: PaymentProviderName;
  providerEventId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export abstract class PaymentEventAbstractRepository {
  /**
   * Inserts an event row. Returns null if a row with the same
   * (provider, providerEventId) already exists — used for idempotency.
   */
  abstract recordIfNew(
    input: RecordPaymentEventInput,
  ): Promise<PaymentEvent | null>;
}
