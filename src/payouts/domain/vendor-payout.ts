import { VendorPayoutStatus } from './payout-enums';

export class VendorPayout {
  id!: string;
  vendorId!: string;
  cycleKey!: string;
  amountMinor!: string;
  currencyCode!: string;
  status!: VendorPayoutStatus;
  ibanSnapshot!: string;
  bankNameSnapshot!: string;
  accountHolderSnapshot!: string | null;
  issuedAt!: Date | null;
  paidAt!: Date | null;
  failedAt!: Date | null;
  failureReason!: string | null;
  adminUserId!: string | null;
  createdAt!: Date;
}
