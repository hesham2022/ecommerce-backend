import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PaymentStatus } from '../domain/payment-enums';
import { StripeProvider } from './stripe.provider';

jest.mock('stripe');

describe('StripeProvider', () => {
  let provider: StripeProvider;
  let stripeMock: jest.Mocked<Stripe.Stripe>;

  beforeEach(() => {
    const config = {
      get: (key: string) => {
        if (key === 'stripe') {
          return {
            secretKey: 'sk_test_x',
            webhookSecret: 'whsec_x',
            publishableKey: 'pk_test_x',
          };
        }
        return undefined;
      },
    } as unknown as ConfigService;

    stripeMock = {
      paymentIntents: {
        create: jest.fn(),
      },
      webhooks: {
        constructEvent: jest.fn(),
      },
    } as unknown as jest.Mocked<Stripe.Stripe>;
    (Stripe as unknown as jest.Mock).mockImplementation(() => stripeMock);

    provider = new StripeProvider(config);
  });

  describe('createIntent', () => {
    it('should create a Stripe PaymentIntent and map the response', async () => {
      (stripeMock.paymentIntents.create as jest.Mock).mockResolvedValue({
        id: 'pi_123',
        client_secret: 'pi_123_secret_x',
        status: 'requires_payment_method',
      });

      const result = await provider.createIntent({
        orderId: 'order-uuid',
        amountMinor: '12345',
        currencyCode: 'USD',
        metadata: { orderId: 'order-uuid' },
      });

      expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith({
        amount: 12345,
        currency: 'usd',
        metadata: { orderId: 'order-uuid' },
        automatic_payment_methods: { enabled: true },
      });
      expect(result).toEqual({
        providerIntentId: 'pi_123',
        clientSecret: 'pi_123_secret_x',
        status: PaymentStatus.REQUIRES_ACTION,
      });
    });

    it('should translate StripeCardError into UnprocessableEntityException', async () => {
      (stripeMock.paymentIntents.create as jest.Mock).mockRejectedValue({
        type: 'StripeCardError',
        message: 'Your card was declined',
      });

      await expect(
        provider.createIntent({
          orderId: 'order-uuid',
          amountMinor: '100',
          currencyCode: 'USD',
          metadata: {},
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: {
          code: 'card_declined',
          message: 'Your card was declined',
        },
      });
    });
  });

  describe('verifyAndParseWebhook', () => {
    it('should parse payment_intent.succeeded into SUCCEEDED status', () => {
      (stripeMock.webhooks.constructEvent as jest.Mock).mockReturnValue({
        id: 'evt_1',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_123',
            status: 'succeeded',
            last_payment_error: null,
          },
        },
      });

      const event = provider.verifyAndParseWebhook(
        Buffer.from('{}'),
        't=1,v1=sig',
      );

      expect(event.providerEventId).toBe('evt_1');
      expect(event.eventType).toBe('payment_intent.succeeded');
      expect(event.providerIntentId).toBe('pi_123');
      expect(event.status).toBe(PaymentStatus.SUCCEEDED);
      expect(event.errorMessage).toBeNull();
    });

    it('should parse payment_intent.payment_failed into FAILED status', () => {
      (stripeMock.webhooks.constructEvent as jest.Mock).mockReturnValue({
        id: 'evt_2',
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_456',
            status: 'requires_payment_method',
            last_payment_error: { message: 'card declined' },
          },
        },
      });

      const event = provider.verifyAndParseWebhook(
        Buffer.from('{}'),
        't=1,v1=sig',
      );

      expect(event.status).toBe(PaymentStatus.FAILED);
      expect(event.errorMessage).toBe('card declined');
    });

    it('should throw if Stripe rejects the signature', () => {
      (stripeMock.webhooks.constructEvent as jest.Mock).mockImplementation(
        () => {
          throw new Error('Invalid signature');
        },
      );

      expect(() =>
        provider.verifyAndParseWebhook(Buffer.from('{}'), 'bad-sig'),
      ).toThrow('Invalid signature');
    });
  });

  describe('boot without config', () => {
    it('should construct without throwing when Stripe keys are missing', () => {
      const emptyConfig = {
        get: () => undefined,
      } as unknown as ConfigService;
      expect(() => new StripeProvider(emptyConfig)).not.toThrow();
    });

    it('should throw on createIntent when secretKey is missing', async () => {
      const emptyConfig = {
        get: () => undefined,
      } as unknown as ConfigService;
      const p = new StripeProvider(emptyConfig);
      await expect(
        p.createIntent({
          orderId: 'o',
          amountMinor: '100',
          currencyCode: 'USD',
          metadata: {},
        }),
      ).rejects.toThrow(/STRIPE_SECRET_KEY/);
    });
  });
});
