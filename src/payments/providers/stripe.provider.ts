import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PaymentProviderName, PaymentStatus } from '../domain/payment-enums';
import { StripeConfig } from '../config/stripe-config.type';
import {
  CreateIntentInput,
  CreateIntentResult,
  ParsedWebhookEvent,
  PaymentProviderInterface,
} from './payment-provider.interface';

/**
 * Stripe PaymentIntent.Status string union, mirrored locally to keep the
 * STATUS_MAP exhaustive without depending on the Stripe SDK's namespace
 * shape (the v22 cjs build does not re-export `Stripe.PaymentIntent` from
 * the default import). If Stripe adds a status, the type below should be
 * extended; unknown values fall back to REQUIRES_ACTION via the nullish
 * coalesce in mapStatus.
 */
type StripePaymentIntentStatus =
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'requires_action'
  | 'processing'
  | 'requires_capture'
  | 'succeeded'
  | 'canceled';

interface StripePaymentIntentLike {
  id: string;
  status: StripePaymentIntentStatus;
  last_payment_error?: { message?: string | null } | null;
}

const STATUS_MAP: Record<StripePaymentIntentStatus, PaymentStatus> = {
  requires_payment_method: PaymentStatus.REQUIRES_ACTION,
  requires_confirmation: PaymentStatus.REQUIRES_ACTION,
  requires_action: PaymentStatus.REQUIRES_ACTION,
  processing: PaymentStatus.PROCESSING,
  requires_capture: PaymentStatus.PROCESSING,
  succeeded: PaymentStatus.SUCCEEDED,
  canceled: PaymentStatus.CANCELED,
};

@Injectable()
export class StripeProvider extends PaymentProviderInterface {
  readonly name = PaymentProviderName.STRIPE;
  private readonly cfg: StripeConfig | undefined;
  private stripeClient: Stripe.Stripe | undefined;

  constructor(config: ConfigService) {
    super();
    this.cfg = config.get<StripeConfig>('stripe');
    // Intentionally lazy: COD-only environments boot fine; missing Stripe
    // config is reported only at first CARD use (with a clear error).
  }

  async createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    const stripe = this.requireStripe();
    let intent: StripePaymentIntentLike & { client_secret: string | null };
    try {
      intent = (await stripe.paymentIntents.create({
        amount: Number(input.amountMinor),
        currency: input.currencyCode.toLowerCase(),
        metadata: input.metadata,
        automatic_payment_methods: { enabled: true },
      })) as unknown as StripePaymentIntentLike & {
        client_secret: string | null;
      };
    } catch (err) {
      this.translateStripeError(err);
    }
    return {
      providerIntentId: intent.id,
      clientSecret: intent.client_secret ?? null,
      status: this.mapStatus(intent.status),
    };
  }

  verifyAndParseWebhook(
    rawBody: Buffer,
    signatureHeader: string,
  ): ParsedWebhookEvent {
    const stripe = this.requireStripe();
    const webhookSecret = this.requireWebhookSecret();
    const event = stripe.webhooks.constructEvent(
      rawBody,
      signatureHeader,
      webhookSecret,
    );
    const intent = event.data.object as unknown as StripePaymentIntentLike;

    let status: PaymentStatus;
    if (event.type === 'payment_intent.payment_failed') {
      status = PaymentStatus.FAILED;
    } else if (event.type === 'payment_intent.canceled') {
      status = PaymentStatus.CANCELED;
    } else {
      status = this.mapStatus(intent.status);
    }

    return {
      providerEventId: event.id,
      eventType: event.type,
      providerIntentId: intent.id,
      status,
      errorMessage: intent.last_payment_error?.message ?? null,
      raw: event as unknown as Record<string, unknown>,
    };
  }

  private requireStripe(): Stripe.Stripe {
    if (this.stripeClient) return this.stripeClient;
    if (!this.cfg?.secretKey) {
      throw new InternalServerErrorException(
        'Stripe is not configured (set STRIPE_SECRET_KEY)',
      );
    }
    this.stripeClient = new Stripe(this.cfg.secretKey, {
      apiVersion: '2026-04-22.dahlia',
    });
    return this.stripeClient;
  }

  private requireWebhookSecret(): string {
    if (!this.cfg?.webhookSecret) {
      throw new InternalServerErrorException(
        'Stripe webhook secret is not configured (set STRIPE_WEBHOOK_SECRET)',
      );
    }
    return this.cfg.webhookSecret;
  }

  private translateStripeError(err: unknown): never {
    if (err && typeof err === 'object' && 'type' in err) {
      const e = err as { type: string; message?: string };
      if (e.type === 'StripeCardError') {
        throw new UnprocessableEntityException({
          code: 'card_declined',
          message: e.message ?? 'Card was declined',
        });
      }
      if (e.type === 'StripeInvalidRequestError') {
        throw new BadRequestException(
          e.message ?? 'Invalid request to payment provider',
        );
      }
    }
    throw new InternalServerErrorException('Payment provider error');
  }

  private mapStatus(s: StripePaymentIntentStatus): PaymentStatus {
    return STATUS_MAP[s] ?? PaymentStatus.REQUIRES_ACTION;
  }
}
