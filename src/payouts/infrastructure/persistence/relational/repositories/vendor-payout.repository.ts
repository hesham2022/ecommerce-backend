import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VendorPayout } from '../../../../domain/vendor-payout';
import {
  CreatePayoutInput,
  ListPayoutFilter,
  UpdatePayoutPatch,
  VendorPayoutRepository,
} from '../../vendor-payout.abstract.repository';
import { VendorPayoutEntity } from '../entities/vendor-payout.entity';
import { VendorPayoutMapper } from '../mappers/vendor-payout.mapper';

@Injectable()
export class VendorPayoutRelationalRepository extends VendorPayoutRepository {
  constructor(
    @InjectRepository(VendorPayoutEntity)
    private readonly repo: Repository<VendorPayoutEntity>,
  ) {
    super();
  }

  async create(input: CreatePayoutInput): Promise<VendorPayout> {
    const ent = this.repo.create({
      vendorId: input.vendorId,
      cycleKey: input.cycleKey,
      amountMinor: input.amountMinor,
      currencyCode: input.currencyCode,
      ibanSnapshot: input.ibanSnapshot,
      bankNameSnapshot: input.bankNameSnapshot,
      accountHolderSnapshot: input.accountHolderSnapshot,
    });
    const saved = await this.repo.save(ent);
    return VendorPayoutMapper.toDomain(saved);
  }

  async findById(id: string): Promise<VendorPayout | null> {
    const row = await this.repo.findOne({ where: { id } });
    return row ? VendorPayoutMapper.toDomain(row) : null;
  }

  async list(
    filter: ListPayoutFilter,
  ): Promise<{ data: VendorPayout[]; hasNextPage: boolean }> {
    const qb = this.repo.createQueryBuilder('p');
    if (filter.vendorId)
      qb.andWhere('p.vendor_id = :vid', { vid: filter.vendorId });
    if (filter.status)
      qb.andWhere('p.status = :status', { status: filter.status });
    if (filter.cycleKey)
      qb.andWhere('p.cycle_key = :ck', { ck: filter.cycleKey });
    qb.orderBy('p.created_at', 'DESC')
      .skip((filter.page - 1) * filter.limit)
      .take(filter.limit + 1);
    const rows = await qb.getMany();
    const hasNextPage = rows.length > filter.limit;
    return {
      data: rows.slice(0, filter.limit).map(VendorPayoutMapper.toDomain),
      hasNextPage,
    };
  }

  async findByCycle(cycleKey: string): Promise<VendorPayout[]> {
    const rows = await this.repo.find({ where: { cycleKey } });
    return rows.map(VendorPayoutMapper.toDomain);
  }

  async update(id: string, patch: UpdatePayoutPatch): Promise<VendorPayout> {
    await this.repo.update({ id }, patch);
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new Error(`payout ${id} not found after update`);
    return VendorPayoutMapper.toDomain(row);
  }
}
