import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsAdminController } from './settings-admin.controller';
import { SettingsService } from './settings.service';
import { RelationalSettingPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { AdminAuditLogModule } from '../admin-audit-log/admin-audit-log.module';

@Module({
  imports: [RelationalSettingPersistenceModule, AdminAuditLogModule],
  controllers: [SettingsController, SettingsAdminController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
