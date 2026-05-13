import { LedgerEntryType } from './payout-enums';

export class VendorLedgerEntry {
  id!: string;
  vendorId!: string;
  type!: LedgerEntryType;
  amountMinor!: string;
  currencyCode!: string;
  availableAt!: Date;
  subOrderId!: string | null;
  returnId!: string | null;
  payoutId!: string | null;
  adminUserId!: string | null;
  memo!: string | null;
  createdAt!: Date;
}
