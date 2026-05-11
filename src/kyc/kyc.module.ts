import { Module } from '@nestjs/common';
import { AdminAuditLogModule } from '../admin-audit-log/admin-audit-log.module';
import { FilesModule } from '../files/files.module';
import { VendorsModule } from '../vendors/vendors.module';
import { AdminKycController } from './admin-kyc.controller';
import { RelationalKycPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { KycService } from './kyc.service';
import { VendorKycController } from './vendor-kyc.controller';

@Module({
  imports: [
    RelationalKycPersistenceModule,
    FilesModule,
    // VendorsModule (not ProductsModule) — the vendor controller relies on
    // VendorsService.getCallingVendor, which returns the vendor regardless of
    // status so PENDING vendors can still submit KYC before activation.
    VendorsModule,
    AdminAuditLogModule,
  ],
  controllers: [VendorKycController, AdminKycController],
  providers: [KycService],
  exports: [KycService],
})
export class KycModule {}
