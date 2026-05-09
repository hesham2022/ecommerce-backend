import { AdminAuditLog } from '../../domain/admin-audit-log';

export interface CreateAuditInput {
  adminUserId: number;
  action: string;
  targetType: string;
  targetId?: string | null;
  payload?: Record<string, unknown> | null;
}

export interface FindAuditOptions {
  adminUserId?: number;
  action?: string;
  targetType?: string;
  page: number;
  limit: number;
}

export interface FindAuditResult {
  data: AdminAuditLog[];
  total: number;
}

export abstract class AdminAuditLogAbstractRepository {
  abstract create(input: CreateAuditInput): Promise<AdminAuditLog>;
  abstract findAll(opts: FindAuditOptions): Promise<FindAuditResult>;
}
