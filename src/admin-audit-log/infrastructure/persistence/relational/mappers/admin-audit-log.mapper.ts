import { AdminAuditLog } from '../../../../domain/admin-audit-log';
import { AdminAuditLogEntity } from '../entities/admin-audit-log.entity';

export class AdminAuditLogMapper {
  static toDomain(entity: AdminAuditLogEntity): AdminAuditLog {
    const dom = new AdminAuditLog();
    dom.id = entity.id;
    dom.adminUserId = entity.adminUserId;
    dom.action = entity.action;
    dom.targetType = entity.targetType;
    dom.targetId = entity.targetId ?? '';
    dom.payload = entity.payload ?? {};
    dom.createdAt = entity.createdAt;
    return dom;
  }
}
