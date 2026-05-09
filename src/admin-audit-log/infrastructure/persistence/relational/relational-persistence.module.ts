import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuditLogAbstractRepository } from '../admin-audit-log.abstract.repository';
import { AdminAuditLogEntity } from './entities/admin-audit-log.entity';
import { AdminAuditLogRelationalRepository } from './repositories/admin-audit-log.repository';

@Module({
  imports: [TypeOrmModule.forFeature([AdminAuditLogEntity])],
  providers: [
    {
      provide: AdminAuditLogAbstractRepository,
      useClass: AdminAuditLogRelationalRepository,
    },
  ],
  exports: [AdminAuditLogAbstractRepository],
})
export class RelationalAdminAuditLogPersistenceModule {}
