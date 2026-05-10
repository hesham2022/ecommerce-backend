import { Injectable, NotFoundException } from '@nestjs/common';
import { PaymentProviderName } from '../domain/payment-enums';
import { PaymentProviderInterface } from './payment-provider.interface';
import { StripeProvider } from './stripe.provider';

@Injectable()
export class PaymentProviderRegistry {
  private readonly providers: Map<
    PaymentProviderName,
    PaymentProviderInterface
  >;

  constructor(stripe: StripeProvider) {
    this.providers = new Map<PaymentProviderName, PaymentProviderInterface>([
      [stripe.name, stripe],
    ]);
  }

  get(name: PaymentProviderName): PaymentProviderInterface {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new NotFoundException(`Payment provider ${name} is not configured`);
    }
    return provider;
  }
}
