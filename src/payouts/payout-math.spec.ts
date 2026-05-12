import {
  computeEarning,
  computeClawback,
  proportionalRefundSplit,
} from './payout-math';

describe('computeEarning', () => {
  it('should take commission from subtotal only; shipping paid in full', () => {
    const result = computeEarning({
      subtotalMinor: '10000',
      shippingMinor: '1500',
      commissionRate: '0.10',
    });
    expect(result).toBe('10500');
  });

  it('should floor fractional fee', () => {
    const result = computeEarning({
      subtotalMinor: '333',
      shippingMinor: '0',
      commissionRate: '0.10',
    });
    expect(result).toBe('300');
  });

  it('should handle zero rate', () => {
    const result = computeEarning({
      subtotalMinor: '10000',
      shippingMinor: '500',
      commissionRate: '0',
    });
    expect(result).toBe('10500');
  });

  it('should handle full-rate (100% commission)', () => {
    const result = computeEarning({
      subtotalMinor: '10000',
      shippingMinor: '500',
      commissionRate: '1.0',
    });
    expect(result).toBe('500');
  });
});

describe('computeClawback', () => {
  it('should refund vendor net portion of subtotal + full shipping share', () => {
    const result = computeClawback({
      refundedSubtotalMinor: '10000',
      refundedShippingMinor: '1500',
      commissionRate: '0.10',
    });
    expect(result).toBe('10500');
  });

  it('should handle partial subtotal refund, no shipping refund', () => {
    const result = computeClawback({
      refundedSubtotalMinor: '5000',
      refundedShippingMinor: '0',
      commissionRate: '0.20',
    });
    expect(result).toBe('4000');
  });

  it('should round toward zero for fractional clawbacks (floor)', () => {
    const result = computeClawback({
      refundedSubtotalMinor: '333',
      refundedShippingMinor: '0',
      commissionRate: '0.10',
    });
    expect(result).toBe('299');
  });
});

describe('proportionalRefundSplit', () => {
  it('should allocate refund between subtotal and shipping proportional to original', () => {
    const result = proportionalRefundSplit({
      totalRefundMinor: '5750',
      originalSubtotalMinor: '10000',
      originalShippingMinor: '1500',
    });
    expect(result).toEqual({
      refundedSubtotalMinor: '5000',
      refundedShippingMinor: '750',
    });
  });

  it('should allocate everything to subtotal when shipping was zero', () => {
    const result = proportionalRefundSplit({
      totalRefundMinor: '3000',
      originalSubtotalMinor: '10000',
      originalShippingMinor: '0',
    });
    expect(result).toEqual({
      refundedSubtotalMinor: '3000',
      refundedShippingMinor: '0',
    });
  });
});
