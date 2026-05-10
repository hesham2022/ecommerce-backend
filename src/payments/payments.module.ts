import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OrdersModule } from '../orders/orders.module';
import stripeConfig from './config/stripe.config';
import { RelationalPaymentPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';
import { StripeProvider } from './providers/stripe.provider';
import { StripeWebhookController } from './webhooks/stripe-webhook.controller';
import { WebhookHandlerService } from './webhooks/webhook-handler.service';

@Module({
  imports: [
    ConfigModule.forFeature(stripeConfig),
    RelationalPaymentPersistenceModule,
    forwardRef(() => OrdersModule),
  ],
  controllers: [PaymentsController, StripeWebhookController],
  providers: [
    PaymentsService,
    StripeProvider,
    PaymentProviderRegistry,
    WebhookHandlerService,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
