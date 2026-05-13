import { PayoutCsvService } from './payout-csv.service';
import { VendorPayoutStatus } from './domain/payout-enums';

describe('PayoutCsvService.generate', () => {
  const svc = new PayoutCsvService();

  const row = (overrides = {}) => ({
    id: 'p1',
    vendorId: 'v1',
    vendorName: 'Acme Trading Co',
    cycleKey: '2026-W19',
    amountMinor: '45000',
    currencyCode: 'SAR',
    status: VendorPayoutStatus.PENDING,
    ibanSnapshot: 'SA0380000000608010167519',
    bankNameSnapshot: 'Bank X',
    accountHolderSnapshot: 'Acme Trading LLC',
    ...overrides,
  });

  it('should start with UTF-8 BOM', () => {
    const csv = svc.generate('2026-W19', [row()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('should have a header row matching the spec', () => {
    const csv = svc.generate('2026-W19', [row()]);
    const lines = csv.split('\n');
    expect(lines[0].replace(/^﻿/, '')).toBe(
      'payout_id,vendor_id,vendor_name,iban,bank_name,account_holder,amount,currency,reference,memo',
    );
  });

  it('should format amount as major-unit with two decimals', () => {
    const csv = svc.generate('2026-W19', [row({ amountMinor: '45000' })]);
    expect(csv).toContain('"450.00"');
  });

  it('should number references sequentially within a batch', () => {
    const csv = svc.generate('2026-W19', [
      row({ id: 'p1' }),
      row({ id: 'p2' }),
    ]);
    expect(csv).toContain('"PAYOUT-2026-W19-001"');
    expect(csv).toContain('"PAYOUT-2026-W19-002"');
  });

  it('should quote and escape embedded quotes in fields', () => {
    const csv = svc.generate('2026-W19', [
      row({ vendorName: 'Acme "Trading" Co' }),
    ]);
    expect(csv).toContain('"Acme ""Trading"" Co"');
  });

  it('should handle null accountHolder as empty string', () => {
    const csv = svc.generate('2026-W19', [
      row({ accountHolderSnapshot: null }),
    ]);
    // The empty account_holder should appear as quoted empty between bank_name and amount
    expect(csv).toMatch(/"Bank X","",/);
  });
});
