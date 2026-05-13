import { VendorLedgerEntry } from '../../../../domain/vendor-ledger-entry';
import { VendorLedgerEntryEntity } from '../entities/vendor-ledger-entry.entity';

export class VendorLedgerEntryMapper {
  static toDomain(e: VendorLedgerEntryEntity): VendorLedgerEntry {
    const d = new VendorLedgerEntry();
    d.id = e.id;
    d.vendorId = e.vendorId;
    d.type = e.type;
    d.amountMinor = e.amountMinor;
    d.currencyCode = e.currencyCode;
    d.availableAt = e.availableAt;
    d.subOrderId = e.subOrderId;
    d.returnId = e.returnId;
    d.payoutId = e.payoutId;
    d.adminUserId = e.adminUserId;
    d.memo = e.memo;
    d.createdAt = e.createdAt;
    return d;
  }
}
