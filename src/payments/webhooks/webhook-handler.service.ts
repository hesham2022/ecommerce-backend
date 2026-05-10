import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { uuidv7Generate } from '../../utils/uuid';
import { OrdersService } from '../../orders/orders.service';
import { PaymentProviderName, PaymentStatus } from '../domain/payment-enums';
import { PaymentAbstractRepository } from '../infrastructure/persistence/payment.abstract.repository';
import { PaymentEventAbstractRepository } from '../infrastructure/persistence/payment-event.abstract.repository';
import { ParsedWebhookEvent } from '../providers/payment-provider.interface';

@Injectable()
export class WebhookHandlerService {
  private readonly logger = new Logger(WebhookHandlerService.name);

  constructor(
    private readonly payments: PaymentAbstractRepository,
    private readonly events: PaymentEventAbstractRepository,
    private readonly orders: OrdersService,
  ) {}

  async handle(
    event: ParsedWebhookEvent,
    provider: PaymentProviderName,
  ): Promise<void> {
    const payment = await this.payments.findByProviderIntent(
      provider,
      event.providerIntentId,
    );
    if (!payment) {
      throw new NotFoundException(
        `Webhook references unknown payment intent ${event.providerIntentId}`,
      );
    }

    // Idempotency: try to insert the event row first. If a duplicate
    // (provider, providerEventId) already exists, recordIfNew returns null
    // and we bail out.
    const recorded = await this.events.recordIfNew({
      id: uuidv7Generate(),
      paymentId: payment.id,
      provider,
      providerEventId: event.providerEventId,
      eventType: event.eventType,
      payload: event.raw,
    });
    if (!recorded) {
      this.logger.log(
        `Skipping duplicate webhook ${provider}:${event.providerEventId}`,
      );
      return;
    }

    await this.payments.updateStatus({
      id: payment.id,
      status: event.status,
      lastError: event.errorMessage,
    });

    if (event.status === PaymentStatus.SUCCEEDED) {
      await this.orders.markPaid(payment.orderId);
    } else if (
      event.status === PaymentStatus.FAILED ||
      event.status === PaymentStatus.CANCELED
    ) {
      await this.orders.cancelForFailedPayment(
        payment.orderId,
        event.errorMessage ?? 'payment failed',
      );
    }
  }
}
