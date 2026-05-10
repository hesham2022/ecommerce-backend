import { Payment } from '../../domain/payment';
import { PaymentProviderName, PaymentStatus } from '../../domain/payment-enums';

export interface CreatePaymentInput {
  id: string;
  orderId: string;
  provider: PaymentProviderName;
  providerIntentId: string;
  clientSecret: string | null;
  status: PaymentStatus;
  amountMinor: string;
  currencyCode: string;
  metadata: Record<string, unknown>;
}

export interface UpdatePaymentStatusInput {
  id: string;
  status: PaymentStatus;
  lastError?: string | null;
}

export abstract class PaymentAbstractRepository {
  abstract create(input: CreatePaymentInput): Promise<Payment>;
  abstract findById(id: string): Promise<Payment | null>;
  abstract findByOrderId(orderId: string): Promise<Payment | null>;
  abstract findByProviderIntent(
    provider: PaymentProviderName,
    providerIntentId: string,
  ): Promise<Payment | null>;
  abstract updateStatus(input: UpdatePaymentStatusInput): Promise<Payment>;
}
