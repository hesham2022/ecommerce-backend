import { PaymentProviderName, PaymentStatus } from '../domain/payment-enums';

export interface CreateIntentInput {
  orderId: string;
  amountMinor: string;
  currencyCode: string;
  metadata: Record<string, string>;
}

export interface CreateIntentResult {
  providerIntentId: string;
  clientSecret: string | null;
  status: PaymentStatus;
}

export interface ParsedWebhookEvent {
  providerEventId: string;
  eventType: string;
  providerIntentId: string;
  status: PaymentStatus;
  errorMessage: string | null;
  raw: Record<string, unknown>;
}

/**
 * Implemented once per gateway (Stripe today; Tap/HyperPay later).
 * The interface is intentionally narrow — only what checkout + webhooks
 * need today. Refunds + payouts will extend this in 9b/9d.
 */
export abstract class PaymentProviderInterface {
  abstract readonly name: PaymentProviderName;

  abstract createIntent(input: CreateIntentInput): Promise<CreateIntentResult>;

  /**
   * Verify the signature header against the raw request body. Throws if
   * the signature is invalid. Returns the parsed event on success.
   */
  abstract verifyAndParseWebhook(
    rawBody: Buffer,
    signatureHeader: string,
  ): ParsedWebhookEvent;
}
