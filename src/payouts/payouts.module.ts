import { Module, forwardRef } from '@nestjs/common';
import { PayoutsRelationalPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { PayoutService } from './payout.service';
import { PayoutCsvService } from './payout-csv.service';
import { PayoutCronService } from './payout-cron.service';
import { VendorPayoutController } from './vendor-payout.controller';
import { AdminPayoutController } from './admin-payout.controller';
import { VendorsModule } from '../vendors/vendors.module';
import { KycModule } from '../kyc/kyc.module';
import { SettingsModule } from '../settings/settings.module';
import { AdminAuditLogModule } from '../admin-audit-log/admin-audit-log.module';

@Module({
  imports: [
    PayoutsRelationalPersistenceModule,
    forwardRef(() => VendorsModule),
    KycModule,
    SettingsModule,
    AdminAuditLogModule,
  ],
  providers: [PayoutService, PayoutCsvService, PayoutCronService],
  controllers: [VendorPayoutController, AdminPayoutController],
  exports: [PayoutService],
})
export class PayoutsModule {}
