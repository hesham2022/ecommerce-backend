import { Injectable, NotFoundException } from '@nestjs/common';
import { uuidv7Generate } from '../utils/uuid';
import { Payment } from './domain/payment';
import { PaymentProviderName, PaymentStatus } from './domain/payment-enums';
import { PaymentAbstractRepository } from './infrastructure/persistence/payment.abstract.repository';
import { PaymentEventAbstractRepository } from './infrastructure/persistence/payment-event.abstract.repository';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';

export interface CreatePaymentForOrderInput {
  orderId: string;
  provider: PaymentProviderName;
  amountMinor: string;
  currencyCode: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly payments: PaymentAbstractRepository,
    private readonly events: PaymentEventAbstractRepository,
    private readonly registry: PaymentProviderRegistry,
  ) {}

  async createForOrder(input: CreatePaymentForOrderInput): Promise<Payment> {
    const provider = this.registry.get(input.provider);
    const intent = await provider.createIntent({
      orderId: input.orderId,
      amountMinor: input.amountMinor,
      currencyCode: input.currencyCode,
      metadata: { orderId: input.orderId },
    });

    return this.payments.create({
      id: uuidv7Generate(),
      orderId: input.orderId,
      provider: input.provider,
      providerIntentId: intent.providerIntentId,
      clientSecret: intent.clientSecret,
      status: intent.status,
      amountMinor: input.amountMinor,
      currencyCode: input.currencyCode,
      metadata: {},
    });
  }

  async findById(id: string): Promise<Payment> {
    const payment = await this.payments.findById(id);
    if (!payment) throw new NotFoundException(`Payment ${id} not found`);
    return payment;
  }

  async findByOrderId(orderId: string): Promise<Payment | null> {
    return this.payments.findByOrderId(orderId);
  }

  async markStatus(
    paymentId: string,
    status: PaymentStatus,
    errorMessage: string | null,
  ): Promise<Payment> {
    return this.payments.updateStatus({
      id: paymentId,
      status,
      lastError: errorMessage,
    });
  }
}
