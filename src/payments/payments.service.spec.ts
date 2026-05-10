import { Test } from '@nestjs/testing';
import { PaymentsService } from './payments.service';
import { PaymentAbstractRepository } from './infrastructure/persistence/payment.abstract.repository';
import { PaymentEventAbstractRepository } from './infrastructure/persistence/payment-event.abstract.repository';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';
import { PaymentProviderName, PaymentStatus } from './domain/payment-enums';
import { Payment } from './domain/payment';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let paymentRepo: jest.Mocked<PaymentAbstractRepository>;
  let registry: jest.Mocked<PaymentProviderRegistry>;
  const stripeProvider = {
    name: PaymentProviderName.STRIPE,
    createIntent: jest.fn(),
    verifyAndParseWebhook: jest.fn(),
  };

  beforeEach(async () => {
    paymentRepo = {
      create: jest.fn(),
      findById: jest.fn(),
      findByOrderId: jest.fn(),
      findByProviderIntent: jest.fn(),
      updateStatus: jest.fn(),
    } as unknown as jest.Mocked<PaymentAbstractRepository>;

    registry = {
      get: jest.fn().mockReturnValue(stripeProvider),
    } as unknown as jest.Mocked<PaymentProviderRegistry>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PaymentAbstractRepository, useValue: paymentRepo },
        {
          provide: PaymentEventAbstractRepository,
          useValue: { recordIfNew: jest.fn() },
        },
        { provide: PaymentProviderRegistry, useValue: registry },
      ],
    }).compile();
    service = moduleRef.get(PaymentsService);
  });

  it('should call provider then persist payment when createForOrder', async () => {
    stripeProvider.createIntent.mockResolvedValue({
      providerIntentId: 'pi_xyz',
      clientSecret: 'pi_xyz_secret',
      status: PaymentStatus.REQUIRES_ACTION,
    });
    const stored = new Payment();
    stored.id = 'pay-uuid';
    stored.clientSecret = 'pi_xyz_secret';
    stored.providerIntentId = 'pi_xyz';
    stored.status = PaymentStatus.REQUIRES_ACTION;
    paymentRepo.create.mockResolvedValue(stored);

    const result = await service.createForOrder({
      orderId: 'order-uuid',
      provider: PaymentProviderName.STRIPE,
      amountMinor: '5000',
      currencyCode: 'USD',
    });

    expect(stripeProvider.createIntent).toHaveBeenCalledWith({
      orderId: 'order-uuid',
      amountMinor: '5000',
      currencyCode: 'USD',
      metadata: { orderId: 'order-uuid' },
    });
    expect(paymentRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-uuid',
        provider: PaymentProviderName.STRIPE,
        providerIntentId: 'pi_xyz',
        clientSecret: 'pi_xyz_secret',
        status: PaymentStatus.REQUIRES_ACTION,
      }),
    );
    expect(result.clientSecret).toBe('pi_xyz_secret');
  });
});
