import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { PayoutBatch } from '../../../../domain/payout-batch';
import { PayoutBatchStatus } from '../../../../domain/payout-enums';
import {
  ListBatchFilter,
  PayoutBatchRepository,
} from '../../payout-batch.abstract.repository';
import { PayoutBatchEntity } from '../entities/payout-batch.entity';
import { PayoutBatchMapper } from '../mappers/payout-batch.mapper';

@Injectable()
export class PayoutBatchRelationalRepository extends PayoutBatchRepository {
  constructor(
    @InjectRepository(PayoutBatchEntity)
    private readonly repo: Repository<PayoutBatchEntity>,
  ) {
    super();
  }

  async createIfAbsent(cycleKey: string): Promise<PayoutBatch | null> {
    try {
      const saved = await this.repo.save(
        this.repo.create({ cycleKey, status: PayoutBatchStatus.BUILDING }),
      );
      return PayoutBatchMapper.toDomain(saved);
    } catch (e) {
      if (e instanceof QueryFailedError && (e as any).code === '23505')
        return null;
      throw e;
    }
  }

  async findById(id: string): Promise<PayoutBatch | null> {
    const row = await this.repo.findOne({ where: { id } });
    return row ? PayoutBatchMapper.toDomain(row) : null;
  }

  async findByCycle(cycleKey: string): Promise<PayoutBatch | null> {
    const row = await this.repo.findOne({ where: { cycleKey } });
    return row ? PayoutBatchMapper.toDomain(row) : null;
  }

  async markReady(
    id: string,
    vendorCount: number,
    totalAmountMinor: string,
  ): Promise<PayoutBatch> {
    await this.repo.update(
      { id },
      {
        status: PayoutBatchStatus.READY,
        vendorCount,
        totalAmountMinor,
      },
    );
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new Error(`batch ${id} not found after markReady`);
    return PayoutBatchMapper.toDomain(row);
  }

  async list(
    filter: ListBatchFilter,
  ): Promise<{ data: PayoutBatch[]; hasNextPage: boolean }> {
    const qb = this.repo.createQueryBuilder('b');
    if (filter.status)
      qb.andWhere('b.status = :status', { status: filter.status });
    qb.orderBy('b.created_at', 'DESC')
      .skip((filter.page - 1) * filter.limit)
      .take(filter.limit + 1);
    const rows = await qb.getMany();
    const hasNextPage = rows.length > filter.limit;
    return {
      data: rows.slice(0, filter.limit).map(PayoutBatchMapper.toDomain),
      hasNextPage,
    };
  }
}
