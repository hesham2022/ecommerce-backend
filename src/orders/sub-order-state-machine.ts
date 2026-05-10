import { UnprocessableEntityException } from '@nestjs/common';
import {
  OrderPaymentMethod,
  OrderPaymentStatus,
  SubOrderFulfillmentStatus,
} from './domain/order-enums';

/**
 * Allowed forward transitions for a SubOrder, driven by the vendor.
 *
 *   AWAITING_CONFIRMATION → CONFIRMED → PACKED → SHIPPED → DELIVERED
 *
 * CANCELLED is reachable from any state strictly before SHIPPED.
 * DELIVERED is buyer-driven (buyer confirms delivery) — so vendor PATCH
 * cannot set DELIVERED. A separate buyer-only transition handles that.
 */
const VENDOR_FORWARD: Record<
  SubOrderFulfillmentStatus,
  ReadonlySet<SubOrderFulfillmentStatus>
> = {
  [SubOrderFulfillmentStatus.AWAITING_CONFIRMATION]: new Set([
    SubOrderFulfillmentStatus.CONFIRMED,
    SubOrderFulfillmentStatus.CANCELLED,
  ]),
  [SubOrderFulfillmentStatus.CONFIRMED]: new Set([
    SubOrderFulfillmentStatus.PACKED,
    SubOrderFulfillmentStatus.CANCELLED,
  ]),
  [SubOrderFulfillmentStatus.PACKED]: new Set([
    SubOrderFulfillmentStatus.SHIPPED,
    SubOrderFulfillmentStatus.CANCELLED,
  ]),
  [SubOrderFulfillmentStatus.SHIPPED]: new Set<SubOrderFulfillmentStatus>(),
  [SubOrderFulfillmentStatus.DELIVERED]: new Set<SubOrderFulfillmentStatus>(),
  [SubOrderFulfillmentStatus.CANCELLED]: new Set<SubOrderFulfillmentStatus>(),
  [SubOrderFulfillmentStatus.RETURNED]: new Set<SubOrderFulfillmentStatus>(),
};

export type VendorTargetStatus =
  | SubOrderFulfillmentStatus.CONFIRMED
  | SubOrderFulfillmentStatus.PACKED
  | SubOrderFulfillmentStatus.SHIPPED
  | SubOrderFulfillmentStatus.CANCELLED;

export function canVendorTransition(
  from: SubOrderFulfillmentStatus,
  to: VendorTargetStatus,
): boolean {
  return VENDOR_FORWARD[from]?.has(to) ?? false;
}

export function assertVendorTransition(
  from: SubOrderFulfillmentStatus,
  to: VendorTargetStatus,
): void {
  if (!canVendorTransition(from, to)) {
    throw new UnprocessableEntityException(
      `Invalid status transition: ${from} → ${to}`,
    );
  }
}

export function canBuyerConfirmDelivery(
  from: SubOrderFulfillmentStatus,
): boolean {
  return from === SubOrderFulfillmentStatus.SHIPPED;
}

export function assertBuyerCanConfirmDelivery(
  from: SubOrderFulfillmentStatus,
): void {
  if (!canBuyerConfirmDelivery(from)) {
    throw new UnprocessableEntityException(
      `Cannot confirm delivery from ${from}; sub-order must be SHIPPED`,
    );
  }
}

/**
 * Vendors must not see sub-orders for CARD orders that have not been paid.
 * COD orders are always visible (cash collected at delivery).
 */
export function isSubOrderVendorVisible(opts: {
  paymentMethod: OrderPaymentMethod;
  paymentStatus: OrderPaymentStatus;
}): boolean {
  if (opts.paymentMethod === OrderPaymentMethod.COD) return true;
  return opts.paymentStatus === OrderPaymentStatus.COLLECTED;
}
