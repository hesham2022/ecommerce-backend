import { PayoutBatchStatus } from './payout-enums';

export class PayoutBatch {
  id!: string;
  cycleKey!: string;
  vendorCount!: number;
  totalAmountMinor!: string;
  status!: PayoutBatchStatus;
  createdAt!: Date;
}
