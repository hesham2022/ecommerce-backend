import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { uuidv7Generate } from '../../../../../utils/uuid';
import { AdminAuditLog } from '../../../../domain/admin-audit-log';
import {
  AdminAuditLogAbstractRepository,
  CreateAuditInput,
  FindAuditOptions,
  FindAuditResult,
} from '../../admin-audit-log.abstract.repository';
import { AdminAuditLogEntity } from '../entities/admin-audit-log.entity';
import { AdminAuditLogMapper } from '../mappers/admin-audit-log.mapper';

@Injectable()
export class AdminAuditLogRelationalRepository implements AdminAuditLogAbstractRepository {
  constructor(
    @InjectRepository(AdminAuditLogEntity)
    private readonly repo: Repository<AdminAuditLogEntity>,
  ) {}

  async create(input: CreateAuditInput): Promise<AdminAuditLog> {
    const row = this.repo.create({
      id: uuidv7Generate(),
      adminUserId: input.adminUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      payload: input.payload ?? null,
    });
    const saved = await this.repo.save(row);
    return AdminAuditLogMapper.toDomain(saved);
  }

  async findAll(opts: FindAuditOptions): Promise<FindAuditResult> {
    const { adminUserId, action, targetType, page, limit } = opts;
    const qb = this.repo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.adminUser', 'adminUser')
      .orderBy('a.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (adminUserId !== undefined) {
      qb.andWhere('a.adminUserId = :adminUserId', { adminUserId });
    }
    if (action) {
      qb.andWhere('a.action = :action', { action });
    }
    if (targetType) {
      qb.andWhere('a.targetType = :targetType', { targetType });
    }

    const [rows, total] = await qb.getManyAndCount();
    return { data: rows.map(AdminAuditLogMapper.toDomain), total };
  }
}
