import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuditLogController } from './admin-audit-log.controller';
import { AdminAuditLogService } from './admin-audit-log.service';
import { AdminAuditLogEntity } from './infrastructure/persistence/relational/entities/admin-audit-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AdminAuditLogEntity])],
  controllers: [AdminAuditLogController],
  providers: [AdminAuditLogService],
  exports: [AdminAuditLogService],
})
export class AdminAuditLogModule {}
