import { UnprocessableEntityException } from '@nestjs/common';
import { ReturnStatus } from './domain/return-enums';

const VENDOR_FORWARD: Record<ReturnStatus, ReadonlySet<ReturnStatus>> = {
  [ReturnStatus.REQUESTED]: new Set([
    ReturnStatus.APPROVED,
    ReturnStatus.REJECTED,
  ]),
  [ReturnStatus.APPROVED]: new Set<ReturnStatus>(),
  [ReturnStatus.SHIPPED_BACK]: new Set([ReturnStatus.RECEIVED]),
  [ReturnStatus.RECEIVED]: new Set([
    ReturnStatus.REFUNDED,
    ReturnStatus.REJECTED,
  ]),
  [ReturnStatus.REFUNDED]: new Set([ReturnStatus.CLOSED]),
  [ReturnStatus.CLOSED]: new Set<ReturnStatus>(),
  [ReturnStatus.REJECTED]: new Set<ReturnStatus>(),
};

const BUYER_FORWARD: Record<ReturnStatus, ReadonlySet<ReturnStatus>> = {
  [ReturnStatus.REQUESTED]: new Set<ReturnStatus>(),
  [ReturnStatus.APPROVED]: new Set([ReturnStatus.SHIPPED_BACK]),
  [ReturnStatus.SHIPPED_BACK]: new Set<ReturnStatus>(),
  [ReturnStatus.RECEIVED]: new Set<ReturnStatus>(),
  [ReturnStatus.REFUNDED]: new Set<ReturnStatus>(),
  [ReturnStatus.CLOSED]: new Set<ReturnStatus>(),
  [ReturnStatus.REJECTED]: new Set<ReturnStatus>(),
};

export function canVendorTransition(
  from: ReturnStatus,
  to: ReturnStatus,
): boolean {
  return VENDOR_FORWARD[from]?.has(to) ?? false;
}

export function canBuyerTransition(
  from: ReturnStatus,
  to: ReturnStatus,
): boolean {
  return BUYER_FORWARD[from]?.has(to) ?? false;
}

export function assertVendorTransition(
  from: ReturnStatus,
  to: ReturnStatus,
): void {
  if (!canVendorTransition(from, to)) {
    throw new UnprocessableEntityException(
      `Invalid return transition: ${from} → ${to}`,
    );
  }
}

export function assertBuyerTransition(
  from: ReturnStatus,
  to: ReturnStatus,
): void {
  if (!canBuyerTransition(from, to)) {
    throw new UnprocessableEntityException(
      `Invalid return transition: ${from} → ${to}`,
    );
  }
}
