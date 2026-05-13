import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VendorLedgerEntryEntity } from './entities/vendor-ledger-entry.entity';
import { VendorPayoutEntity } from './entities/vendor-payout.entity';
import { PayoutBatchEntity } from './entities/payout-batch.entity';
import { VendorLedgerRepository } from '../vendor-ledger.abstract.repository';
import { VendorPayoutRepository } from '../vendor-payout.abstract.repository';
import { PayoutBatchRepository } from '../payout-batch.abstract.repository';
import { VendorLedgerRelationalRepository } from './repositories/vendor-ledger.repository';
import { VendorPayoutRelationalRepository } from './repositories/vendor-payout.repository';
import { PayoutBatchRelationalRepository } from './repositories/payout-batch.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      VendorLedgerEntryEntity,
      VendorPayoutEntity,
      PayoutBatchEntity,
    ]),
  ],
  providers: [
    {
      provide: VendorLedgerRepository,
      useClass: VendorLedgerRelationalRepository,
    },
    {
      provide: VendorPayoutRepository,
      useClass: VendorPayoutRelationalRepository,
    },
    {
      provide: PayoutBatchRepository,
      useClass: PayoutBatchRelationalRepository,
    },
  ],
  exports: [
    VendorLedgerRepository,
    VendorPayoutRepository,
    PayoutBatchRepository,
  ],
})
export class PayoutsRelationalPersistenceModule {}
