import { LedgerEntryType } from './domain/payout-enums';

export interface BalanceSummary {
  heldMinor: string;
  availableMinor: string;
  lifetimePaidMinor: string;
}

export interface BalanceInputEntry {
  type: LedgerEntryType;
  amountMinor: string;
  availableAt: Date;
}

export function computeBalance(
  entries: BalanceInputEntry[],
  asOf: Date,
): BalanceSummary {
  let held = 0n;
  let available = 0n;
  let lifetimePaid = 0n;

  for (const e of entries) {
    const amt = BigInt(e.amountMinor);
    const isFuture = e.availableAt.getTime() > asOf.getTime();

    if (e.type === LedgerEntryType.EARNING && isFuture) {
      held += amt;
    } else {
      available += amt;
    }

    if (e.type === LedgerEntryType.PAYOUT_ISSUED) {
      lifetimePaid += -amt;
    }
    if (e.type === LedgerEntryType.PAYOUT_REVERSED) {
      lifetimePaid -= amt;
    }
  }

  return {
    heldMinor: held.toString(),
    availableMinor: available.toString(),
    lifetimePaidMinor: lifetimePaid.toString(),
  };
}
