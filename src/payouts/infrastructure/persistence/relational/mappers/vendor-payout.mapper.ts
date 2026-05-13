import { VendorPayout } from '../../../../domain/vendor-payout';
import { VendorPayoutEntity } from '../entities/vendor-payout.entity';

export class VendorPayoutMapper {
  static toDomain(e: VendorPayoutEntity): VendorPayout {
    const d = new VendorPayout();
    d.id = e.id;
    d.vendorId = e.vendorId;
    d.cycleKey = e.cycleKey;
    d.amountMinor = e.amountMinor;
    d.currencyCode = e.currencyCode;
    d.status = e.status;
    d.ibanSnapshot = e.ibanSnapshot;
    d.bankNameSnapshot = e.bankNameSnapshot;
    d.accountHolderSnapshot = e.accountHolderSnapshot;
    d.issuedAt = e.issuedAt;
    d.paidAt = e.paidAt;
    d.failedAt = e.failedAt;
    d.failureReason = e.failureReason;
    d.adminUserId = e.adminUserId;
    d.createdAt = e.createdAt;
    return d;
  }
}
