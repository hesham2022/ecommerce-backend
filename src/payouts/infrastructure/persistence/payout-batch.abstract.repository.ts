import { PayoutBatch } from '../../domain/payout-batch';
import { PayoutBatchStatus } from '../../domain/payout-enums';

export interface ListBatchFilter {
  status?: PayoutBatchStatus;
  page: number;
  limit: number;
}

export abstract class PayoutBatchRepository {
  abstract createIfAbsent(cycleKey: string): Promise<PayoutBatch | null>;
  abstract findById(id: string): Promise<PayoutBatch | null>;
  abstract findByCycle(cycleKey: string): Promise<PayoutBatch | null>;
  abstract markReady(
    id: string,
    vendorCount: number,
    totalAmountMinor: string,
  ): Promise<PayoutBatch>;
  abstract list(
    filter: ListBatchFilter,
  ): Promise<{ data: PayoutBatch[]; hasNextPage: boolean }>;
}
