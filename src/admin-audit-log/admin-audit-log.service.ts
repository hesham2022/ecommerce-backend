import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { uuidv7Generate } from '../utils/uuid';
import { AdminAuditLogEntity } from './infrastructure/persistence/relational/entities/admin-audit-log.entity';

export interface RecordAuditLogInput {
  adminUserId: number;
  action: string;
  targetType: string;
  targetId: string;
  payload?: Record<string, unknown>;
}

@Injectable()
export class AdminAuditLogService {
  constructor(
    @InjectRepository(AdminAuditLogEntity)
    private readonly repo: Repository<AdminAuditLogEntity>,
  ) {}

  async record(input: RecordAuditLogInput): Promise<void> {
    const row = this.repo.create({
      id: uuidv7Generate(),
      adminUserId: input.adminUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      payload: input.payload ?? {},
    });
    await this.repo.save(row);
  }

  async log(input: RecordAuditLogInput): Promise<void> {
    return this.record(input);
  }

  async list(filter: {
    adminUserId?: number;
    action?: string;
    targetType?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: AdminAuditLogEntity[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (filter.adminUserId !== undefined) where.adminUserId = filter.adminUserId;
    if (filter.action) where.action = filter.action;
    if (filter.targetType) where.targetType = filter.targetType;
    const limit = filter.limit ?? 20;
    const page = filter.page ?? 1;
    const [data, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
      skip: (page - 1) * limit,
    });
    return { data, total };
  }
}
