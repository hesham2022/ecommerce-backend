import { Test } from '@nestjs/testing';
import { WebhookHandlerService } from './webhook-handler.service';
import { PaymentAbstractRepository } from '../infrastructure/persistence/payment.abstract.repository';
import { PaymentEventAbstractRepository } from '../infrastructure/persistence/payment-event.abstract.repository';
import { PaymentProviderName, PaymentStatus } from '../domain/payment-enums';
import { OrdersService } from '../../orders/orders.service';
import { Payment } from '../domain/payment';

describe('WebhookHandlerService', () => {
  let service: WebhookHandlerService;
  let payments: jest.Mocked<PaymentAbstractRepository>;
  let events: jest.Mocked<PaymentEventAbstractRepository>;
  let orders: jest.Mocked<OrdersService>;

  const dummyPayment = (status = PaymentStatus.REQUIRES_ACTION): Payment => {
    const p = new Payment();
    p.id = 'pay-1';
    p.orderId = 'ord-1';
    p.provider = PaymentProviderName.STRIPE;
    p.providerIntentId = 'pi_1';
    p.status = status;
    return p;
  };

  beforeEach(async () => {
    payments = {
      findByProviderIntent: jest.fn(),
      updateStatus: jest.fn(),
    } as unknown as jest.Mocked<PaymentAbstractRepository>;
    events = {
      recordIfNew: jest.fn(),
    } as unknown as jest.Mocked<PaymentEventAbstractRepository>;
    orders = {
      markPaid: jest.fn(),
      cancelForFailedPayment: jest.fn(),
    } as unknown as jest.Mocked<OrdersService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        WebhookHandlerService,
        { provide: PaymentAbstractRepository, useValue: payments },
        { provide: PaymentEventAbstractRepository, useValue: events },
        { provide: OrdersService, useValue: orders },
      ],
    }).compile();
    service = moduleRef.get(WebhookHandlerService);
  });

  it('should mark payment SUCCEEDED and the order paid', async () => {
    payments.findByProviderIntent.mockResolvedValue(dummyPayment());
    events.recordIfNew.mockResolvedValue({} as never);
    payments.updateStatus.mockResolvedValue(
      dummyPayment(PaymentStatus.SUCCEEDED),
    );

    await service.handle(
      {
        providerEventId: 'evt_1',
        eventType: 'payment_intent.succeeded',
        providerIntentId: 'pi_1',
        status: PaymentStatus.SUCCEEDED,
        errorMessage: null,
        raw: {},
      },
      PaymentProviderName.STRIPE,
    );

    expect(payments.updateStatus).toHaveBeenCalledWith({
      id: 'pay-1',
      status: PaymentStatus.SUCCEEDED,
      lastError: null,
    });
    expect(orders.markPaid).toHaveBeenCalledWith('ord-1');
    expect(orders.cancelForFailedPayment).not.toHaveBeenCalled();
  });

  it('should mark payment FAILED and cancel the order', async () => {
    payments.findByProviderIntent.mockResolvedValue(dummyPayment());
    events.recordIfNew.mockResolvedValue({} as never);
    payments.updateStatus.mockResolvedValue(dummyPayment(PaymentStatus.FAILED));

    await service.handle(
      {
        providerEventId: 'evt_2',
        eventType: 'payment_intent.payment_failed',
        providerIntentId: 'pi_1',
        status: PaymentStatus.FAILED,
        errorMessage: 'card declined',
        raw: {},
      },
      PaymentProviderName.STRIPE,
    );

    expect(orders.cancelForFailedPayment).toHaveBeenCalledWith(
      'ord-1',
      'card declined',
    );
    expect(orders.markPaid).not.toHaveBeenCalled();
  });

  it('should skip processing when the same event is delivered twice', async () => {
    payments.findByProviderIntent.mockResolvedValue(dummyPayment());
    events.recordIfNew.mockResolvedValue(null);

    await service.handle(
      {
        providerEventId: 'evt_1',
        eventType: 'payment_intent.succeeded',
        providerIntentId: 'pi_1',
        status: PaymentStatus.SUCCEEDED,
        errorMessage: null,
        raw: {},
      },
      PaymentProviderName.STRIPE,
    );

    expect(payments.updateStatus).not.toHaveBeenCalled();
    expect(orders.markPaid).not.toHaveBeenCalled();
  });

  it('should throw when the payment intent is unknown', async () => {
    payments.findByProviderIntent.mockResolvedValue(null);

    await expect(
      service.handle(
        {
          providerEventId: 'evt_1',
          eventType: 'payment_intent.succeeded',
          providerIntentId: 'pi_unknown',
          status: PaymentStatus.SUCCEEDED,
          errorMessage: null,
          raw: {},
        },
        PaymentProviderName.STRIPE,
      ),
    ).rejects.toThrow(/unknown/i);
  });
});
