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

describe('PayoutService.onReturnRefunded', () => {
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
      findEarningForSubOrder: jest.fn(),
      findClawbackForReturn: jest.fn().mockResolvedValue(null),
    } as any;
    payouts = {} as any;
    batches = {} as any;
    vendors = { findById: jest.fn() };
    settings = { getValue: jest.fn() };
    audit = { record: jest.fn() };
    kyc = {} as any;
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

  it('should write a negative REFUND_CLAWBACK entry, available immediately, commission proportionally returned', async () => {
    vendors.findById.mockResolvedValue({ id: 'v1', commissionRate: '0.10' });

    await service.onReturnRefunded({
      returnId: 'r1',
      vendorId: 'v1',
      subOrderId: 'so1',
      refundedSubtotalMinor: '10000',
      refundedShippingMinor: '1500',
      currencyCode: 'SAR',
    });

    expect(ledger.create).toHaveBeenCalledTimes(1);
    const arg = ledger.create.mock.calls[0][0];
    expect(arg).toMatchObject({
      vendorId: 'v1',
      type: LedgerEntryType.REFUND_CLAWBACK,
      amountMinor: '-10500',
      currencyCode: 'SAR',
      returnId: 'r1',
      subOrderId: 'so1',
    });
    const diff = Math.abs(Date.now() - arg.availableAt.getTime());
    expect(diff).toBeLessThan(5000);
  });

  it('should be idempotent on returnId', async () => {
    ledger.findClawbackForReturn.mockResolvedValue({ id: 'existing' } as any);
    await service.onReturnRefunded({
      returnId: 'r1',
      vendorId: 'v1',
      subOrderId: 'so1',
      refundedSubtotalMinor: '100',
      refundedShippingMinor: '0',
      currencyCode: 'SAR',
    });
    expect(ledger.create).not.toHaveBeenCalled();
  });
});

describe('PayoutService.issuePayoutsForCycle', () => {
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
      findEarningForSubOrder: jest.fn(),
      findClawbackForReturn: jest.fn(),
    } as any;
    payouts = {
      create: jest.fn(),
      findById: jest.fn(),
      list: jest.fn(),
      findByCycle: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    } as any;
    batches = {
      createIfAbsent: jest.fn(),
      findById: jest.fn(),
      findByCycle: jest.fn(),
      markReady: jest.fn(),
      list: jest.fn(),
    } as any;
    vendors = { findById: jest.fn(), listEligibleForPayout: jest.fn() };
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

  it('should be idempotent on cycleKey — second run returns the existing batch unchanged', async () => {
    batches.createIfAbsent.mockResolvedValue(null);
    batches.findByCycle.mockResolvedValue({
      id: 'b1',
      cycleKey: '2026-W19',
      status: 'READY',
    } as any);

    const result = await service.issuePayoutsForCycle('2026-W19');

    expect(result.batchId).toBe('b1');
    expect(payouts.create).not.toHaveBeenCalled();
  });

  it('should skip vendors below the minimum amount', async () => {
    batches.createIfAbsent.mockResolvedValue({
      id: 'b1',
      cycleKey: '2026-W19',
    } as any);
    settings.getValue.mockResolvedValue('5000');
    vendors.listEligibleForPayout.mockResolvedValue([
      { vendorId: 'v1', availableMinor: '3000', currencyCode: 'SAR' },
      { vendorId: 'v2', availableMinor: '7000', currencyCode: 'SAR' },
    ]);
    vendors.findById.mockImplementation((id: string) =>
      Promise.resolve({
        id,
        status: 'ACTIVE',
        kycStatus: 'APPROVED',
        commissionRate: '0.10',
      }),
    );
    kyc.findLatestApprovedIban.mockResolvedValue({
      iban: 'SA0380',
      bankName: 'BankX',
    });
    payouts.create.mockImplementation((i) =>
      Promise.resolve({ id: 'p2', ...i } as any),
    );

    await service.issuePayoutsForCycle('2026-W19');

    expect(payouts.create).toHaveBeenCalledTimes(1);
    expect(payouts.create.mock.calls[0][0]).toMatchObject({
      vendorId: 'v2',
      amountMinor: '7000',
    });
    expect(ledger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorId: 'v2',
        type: LedgerEntryType.PAYOUT_ISSUED,
        amountMinor: '-7000',
      }),
    );
  });

  it('should skip vendors without an APPROVED IBAN_DOCUMENT', async () => {
    batches.createIfAbsent.mockResolvedValue({
      id: 'b1',
      cycleKey: '2026-W19',
    } as any);
    settings.getValue.mockResolvedValue('5000');
    vendors.listEligibleForPayout.mockResolvedValue([
      { vendorId: 'v1', availableMinor: '7000', currencyCode: 'SAR' },
    ]);
    vendors.findById.mockResolvedValue({
      id: 'v1',
      status: 'ACTIVE',
      kycStatus: 'APPROVED',
      commissionRate: '0.10',
    });
    kyc.findLatestApprovedIban.mockResolvedValue(null);

    await service.issuePayoutsForCycle('2026-W19');

    expect(payouts.create).not.toHaveBeenCalled();
  });

  it('should snapshot banking info from latest APPROVED IBAN_DOCUMENT at issue time', async () => {
    batches.createIfAbsent.mockResolvedValue({
      id: 'b1',
      cycleKey: '2026-W19',
    } as any);
    settings.getValue.mockResolvedValue('5000');
    vendors.listEligibleForPayout.mockResolvedValue([
      { vendorId: 'v1', availableMinor: '7000', currencyCode: 'SAR' },
    ]);
    vendors.findById.mockResolvedValue({
      id: 'v1',
      status: 'ACTIVE',
      kycStatus: 'APPROVED',
      commissionRate: '0.10',
    });
    kyc.findLatestApprovedIban.mockResolvedValue({
      iban: 'SA0380000000608010167519',
      bankName: 'BankX',
      accountHolderName: 'Acme LLC',
    });
    payouts.create.mockImplementation((i) =>
      Promise.resolve({ id: 'p1', ...i } as any),
    );

    await service.issuePayoutsForCycle('2026-W19');

    expect(payouts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ibanSnapshot: 'SA0380000000608010167519',
        bankNameSnapshot: 'BankX',
        accountHolderSnapshot: 'Acme LLC',
      }),
    );
  });
});
