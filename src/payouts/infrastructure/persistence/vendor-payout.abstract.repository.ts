import { VendorPayout } from '../../domain/vendor-payout';
import { VendorPayoutStatus } from '../../domain/payout-enums';

export interface CreatePayoutInput {
  vendorId: string;
  cycleKey: string;
  amountMinor: string;
  currencyCode: string;
  ibanSnapshot: string;
  bankNameSnapshot: string;
  accountHolderSnapshot: string | null;
}

export interface ListPayoutFilter {
  vendorId?: string;
  status?: VendorPayoutStatus;
  cycleKey?: string;
  page: number;
  limit: number;
}

export interface UpdatePayoutPatch {
  status?: VendorPayoutStatus;
  issuedAt?: Date | null;
  paidAt?: Date | null;
  failedAt?: Date | null;
  failureReason?: string | null;
  adminUserId?: string | null;
}

export abstract class VendorPayoutRepository {
  abstract create(input: CreatePayoutInput): Promise<VendorPayout>;
  abstract findById(id: string): Promise<VendorPayout | null>;
  abstract list(
    filter: ListPayoutFilter,
  ): Promise<{ data: VendorPayout[]; hasNextPage: boolean }>;
  abstract findByCycle(cycleKey: string): Promise<VendorPayout[]>;
  abstract update(id: string, patch: UpdatePayoutPatch): Promise<VendorPayout>;
}
