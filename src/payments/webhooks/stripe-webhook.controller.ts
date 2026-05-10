import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PaymentProviderName } from '../domain/payment-enums';
import { PaymentProviderRegistry } from '../providers/payment-provider.registry';
import { WebhookHandlerService } from './webhook-handler.service';

@ApiTags('Webhooks · Stripe')
@Controller({ path: 'payments/webhooks/stripe', version: '1' })
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly registry: PaymentProviderRegistry,
    private readonly handler: WebhookHandlerService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<void> {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }
    if (!req.rawBody) {
      throw new BadRequestException(
        'Missing raw request body — server is not configured for raw-body delivery',
      );
    }

    const provider = this.registry.get(PaymentProviderName.STRIPE);

    let event;
    try {
      event = provider.verifyAndParseWebhook(req.rawBody, signature);
    } catch (err) {
      this.logger.warn(`Stripe signature verification failed: ${String(err)}`);
      throw new BadRequestException('Invalid signature');
    }

    await this.handler.handle(event, PaymentProviderName.STRIPE);
  }
}
