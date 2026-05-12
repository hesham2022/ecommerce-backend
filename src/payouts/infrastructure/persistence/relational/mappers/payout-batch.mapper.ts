import { PayoutBatch } from '../../../../domain/payout-batch';
import { PayoutBatchEntity } from '../entities/payout-batch.entity';

export class PayoutBatchMapper {
  static toDomain(e: PayoutBatchEntity): PayoutBatch {
    const d = new PayoutBatch();
    d.id = e.id;
    d.cycleKey = e.cycleKey;
    d.vendorCount = e.vendorCount;
    d.totalAmountMinor = e.totalAmountMinor;
    d.status = e.status;
    d.createdAt = e.createdAt;
    return d;
  }
}
