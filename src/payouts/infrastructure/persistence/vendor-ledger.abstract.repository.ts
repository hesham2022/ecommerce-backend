import { VendorLedgerEntry } from '../../domain/vendor-ledger-entry';
import { LedgerEntryType } from '../../domain/payout-enums';

export interface CreateLedgerEntryInput {
  vendorId: string;
  type: LedgerEntryType;
  amountMinor: string;
  currencyCode: string;
  availableAt: Date;
  subOrderId?: string | null;
  returnId?: string | null;
  payoutId?: string | null;
  adminUserId?: string | null;
  memo?: string | null;
}

export interface ListLedgerFilter {
  vendorId: string;
  type?: LedgerEntryType;
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
}

export abstract class VendorLedgerRepository {
  abstract create(entry: CreateLedgerEntryInput): Promise<VendorLedgerEntry>;
  abstract findByVendor(vendorId: string): Promise<VendorLedgerEntry[]>;
  abstract list(
    filter: ListLedgerFilter,
  ): Promise<{ data: VendorLedgerEntry[]; hasNextPage: boolean }>;
  abstract findByPayout(payoutId: string): Promise<VendorLedgerEntry[]>;
  abstract findEarningForSubOrder(
    subOrderId: string,
  ): Promise<VendorLedgerEntry | null>;
  abstract findClawbackForReturn(
    returnId: string,
  ): Promise<VendorLedgerEntry | null>;
}
