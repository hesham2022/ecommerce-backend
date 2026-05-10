import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import stripeConfig from './config/stripe.config';
import { RelationalPaymentPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { PaymentsService } from './payments.service';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';
import { StripeProvider } from './providers/stripe.provider';

@Module({
  imports: [
    ConfigModule.forFeature(stripeConfig),
    RelationalPaymentPersistenceModule,
  ],
  providers: [PaymentsService, StripeProvider, PaymentProviderRegistry],
  exports: [PaymentsService],
})
export class PaymentsModule {}
