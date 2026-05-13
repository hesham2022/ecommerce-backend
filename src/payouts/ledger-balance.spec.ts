import { computeBalance } from './ledger-balance';
import { LedgerEntryType } from './domain/payout-enums';

const entry = (
  type: LedgerEntryType,
  amountMinor: string,
  availableAt: string,
): { type: LedgerEntryType; amountMinor: string; availableAt: Date } => ({
  type,
  amountMinor,
  availableAt: new Date(availableAt),
});

const NOW = new Date('2026-05-12T12:00:00Z');

describe('computeBalance', () => {
  it('should return zeros for empty ledger', () => {
    expect(computeBalance([], NOW)).toEqual({
      heldMinor: '0',
      availableMinor: '0',
      lifetimePaidMinor: '0',
    });
  });

  it('should split earnings by availableAt into held vs available', () => {
    const entries = [
      entry(LedgerEntryType.EARNING, '10000', '2026-05-20T00:00:00Z'),
      entry(LedgerEntryType.EARNING, '7000', '2026-05-01T00:00:00Z'),
    ];
    expect(computeBalance(entries, NOW)).toEqual({
      heldMinor: '10000',
      availableMinor: '7000',
      lifetimePaidMinor: '0',
    });
  });

  it('should debit payouts and clawbacks from available; clawbacks do not touch held column', () => {
    const entries = [
      entry(LedgerEntryType.EARNING, '10000', '2026-05-01T00:00:00Z'),
      entry(LedgerEntryType.REFUND_CLAWBACK, '-3000', '2026-05-02T00:00:00Z'),
      entry(LedgerEntryType.PAYOUT_ISSUED, '-5000', '2026-05-03T00:00:00Z'),
    ];
    expect(computeBalance(entries, NOW)).toEqual({
      heldMinor: '0',
      availableMinor: '2000',
      lifetimePaidMinor: '5000',
    });
  });

  it('should cancel reversed payouts from lifetimePaid and add back to available', () => {
    const entries = [
      entry(LedgerEntryType.PAYOUT_ISSUED, '-5000', '2026-05-01T00:00:00Z'),
      entry(LedgerEntryType.PAYOUT_REVERSED, '5000', '2026-05-02T00:00:00Z'),
    ];
    expect(computeBalance(entries, NOW)).toEqual({
      heldMinor: '0',
      availableMinor: '0',
      lifetimePaidMinor: '0',
    });
  });

  it('should allow negative available balance', () => {
    const entries = [
      entry(LedgerEntryType.PAYOUT_ISSUED, '-5000', '2026-05-01T00:00:00Z'),
      entry(LedgerEntryType.REFUND_CLAWBACK, '-2000', '2026-05-02T00:00:00Z'),
    ];
    expect(computeBalance(entries, NOW)).toEqual({
      heldMinor: '0',
      availableMinor: '-7000',
      lifetimePaidMinor: '5000',
    });
  });

  it('should treat ADJUSTMENT entries as available (positive credits, negative debits)', () => {
    const entries = [
      entry(LedgerEntryType.ADJUSTMENT, '2000', '2026-05-01T00:00:00Z'), // credit
      entry(LedgerEntryType.ADJUSTMENT, '-500', '2026-05-02T00:00:00Z'), // debit
    ];
    expect(computeBalance(entries, NOW)).toEqual({
      heldMinor: '0',
      availableMinor: '1500',
      lifetimePaidMinor: '0',
    });
  });
});
