import { PaymentProviderName, PaymentStatus } from './payment-enums';

export class Payment {
  id!: string;
  orderId!: string;
  provider!: PaymentProviderName;
  providerIntentId!: string;
  clientSecret!: string | null;
  status!: PaymentStatus;
  amountMinor!: string;
  currencyCode!: string;
  lastError!: string | null;
  metadata!: Record<string, unknown>;
  createdAt!: Date;
  updatedAt!: Date;
}
