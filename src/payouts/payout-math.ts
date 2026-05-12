interface EarningInput {
  subtotalMinor: string;
  shippingMinor: string;
  commissionRate: string;
}

export function computeEarning(input: EarningInput): string {
  const subtotal = BigInt(input.subtotalMinor);
  const shipping = BigInt(input.shippingMinor);
  const fee = floorMul(subtotal, input.commissionRate);
  return (subtotal + shipping - fee).toString();
}

interface ClawbackInput {
  refundedSubtotalMinor: string;
  refundedShippingMinor: string;
  commissionRate: string;
}

export function computeClawback(input: ClawbackInput): string {
  const subtotal = BigInt(input.refundedSubtotalMinor);
  const shipping = BigInt(input.refundedShippingMinor);
  const netSubtotal = floorMulComplement(subtotal, input.commissionRate);
  return (netSubtotal + shipping).toString();
}

interface SplitInput {
  totalRefundMinor: string;
  originalSubtotalMinor: string;
  originalShippingMinor: string;
}

interface Split {
  refundedSubtotalMinor: string;
  refundedShippingMinor: string;
}

export function proportionalRefundSplit(input: SplitInput): Split {
  const total = BigInt(input.totalRefundMinor);
  const subtotal = BigInt(input.originalSubtotalMinor);
  const shipping = BigInt(input.originalShippingMinor);
  const denom = subtotal + shipping;
  if (denom === 0n) {
    return { refundedSubtotalMinor: '0', refundedShippingMinor: '0' };
  }
  const refundedShipping = (total * shipping) / denom;
  const refundedSubtotal = total - refundedShipping;
  return {
    refundedSubtotalMinor: refundedSubtotal.toString(),
    refundedShippingMinor: refundedShipping.toString(),
  };
}

function floorMul(a: bigint, rate: string): bigint {
  const [whole, frac = ''] = rate.split('.');
  const scale = 10n ** BigInt(frac.length);
  const num = BigInt(whole + frac);
  return (a * num) / scale;
}

// Computes floor(a * (1 - rate)) in a single division to avoid rounding drift.
function floorMulComplement(a: bigint, rate: string): bigint {
  const [whole, frac = ''] = rate.split('.');
  const scale = 10n ** BigInt(frac.length);
  const num = BigInt(whole + frac);
  return (a * (scale - num)) / scale;
}
