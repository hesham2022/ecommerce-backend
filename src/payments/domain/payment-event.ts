import { PaymentProviderName } from './payment-enums';

export class PaymentEvent {
  id!: string;
  paymentId!: string;
  provider!: PaymentProviderName;
  providerEventId!: string;
  eventType!: string;
  payload!: Record<string, unknown>;
  receivedAt!: Date;
}
