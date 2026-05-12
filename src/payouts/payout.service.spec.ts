import { PayoutService } from './payout.service';
import { VendorLedgerRepository } from './infrastructure/persistence/vendor-ledger.abstract.repository';
import { VendorPayoutRepository } from './infrastructure/persistence/vendor-payout.abstract.repository';
import { PayoutBatchRepository } from './infrastructure/persistence/payout-batch.abstract.repository';
import { LedgerEntryType } from './domain/payout-enums';

describe('PayoutService.onSubOrderDelivered', () => {
  let service: PayoutService;
  let ledger: jest.Mocked<VendorLedgerRepository>;
  let payouts: jest.Mocked<VendorPayoutRepository>;
  let batches: jest.Mocked<PayoutBatchRepository>;
  let vendors: any;
  let settings: any;
  let audit: any;
  let kyc: any;

  beforeEach(() => {
    ledger = {
      create: jest.fn(),
      findByVendor: jest.fn(),
      list: jest.fn(),
      findByPayout: jest.fn(),
      findEarningForSubOrder: jest.fn().mockResolvedValue(null),
      findClawbackForReturn: jest.fn(),
    } as any;
    payouts = {
      create: jest.fn(),
      findById: jest.fn(),
      list: jest.fn(),
      findByCycle: jest.fn(),
      update: jest.fn(),
    } as any;
    batches = {
      createIfAbsent: jest.fn(),
      findById: jest.fn(),
      findByCycle: jest.fn(),
      markReady: jest.fn(),
      list: jest.fn(),
    } as any;
    vendors = { findById: jest.fn() };
    settings = { getValue: jest.fn() };
    audit = { record: jest.fn() };
    kyc = { findLatestApprovedIban: jest.fn() };

    service = new PayoutService(
      ledger,
      payouts,
      batches,
      vendors,
      settings,
      audit,
      kyc,
    );
  });

  it('should credit the vendor with subtotal+shipping minus commission, hold=14d in the future', async () => {
    vendors.findById.mockResolvedValue({ id: 'v1', commissionRate: '0.10' });
    settings.getValue.mockResolvedValue(14);

    await service.onSubOrderDelivered({
      subOrderId: 'so1',
      vendorId: 'v1',
      subtotalMinor: '10000',
      shippingMinor: '1500',
      currencyCode: 'SAR',
      deliveredAt: new Date('2026-05-01T00:00:00Z'),
    });

    expect(ledger.create).toHaveBeenCalledTimes(1);
    expect(ledger.create.mock.calls[0][0]).toMatchObject({
      vendorId: 'v1',
      type: LedgerEntryType.EARNING,
      amountMinor: '10500',
      currencyCode: 'SAR',
      subOrderId: 'so1',
    });
    const passed = ledger.create.mock.calls[0][0];
    expect(passed.availableAt.toISOString()).toBe('2026-05-15T00:00:00.000Z');
  });

  it('should be idempotent: skips when an EARNING for this sub-order already exists', async () => {
    ledger.findEarningForSubOrder.mockResolvedValue({ id: 'existing' } as any);

    await service.onSubOrderDelivered({
      subOrderId: 'so1',
      vendorId: 'v1',
      subtotalMinor: '10000',
      shippingMinor: '0',
      currencyCode: 'SAR',
      deliveredAt: new Date(),
    });

    expect(ledger.create).not.toHaveBeenCalled();
  });

  it('should throw if vendor is missing', async () => {
    vendors.findById.mockResolvedValue(null);
    await expect(
      service.onSubOrderDelivered({
        subOrderId: 'so1',
        vendorId: 'v1',
        subtotalMinor: '100',
        shippingMinor: '0',
        currencyCode: 'SAR',
        deliveredAt: new Date(),
      }),
    ).rejects.toThrow(/vendor v1 not found/i);
  });
});
