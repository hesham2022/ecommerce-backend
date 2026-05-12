import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VendorLedgerEntry } from '../../../../domain/vendor-ledger-entry';
import { LedgerEntryType } from '../../../../domain/payout-enums';
import {
  CreateLedgerEntryInput,
  ListLedgerFilter,
  VendorLedgerRepository,
} from '../../vendor-ledger.abstract.repository';
import { VendorLedgerEntryEntity } from '../entities/vendor-ledger-entry.entity';
import { VendorLedgerEntryMapper } from '../mappers/vendor-ledger-entry.mapper';

@Injectable()
export class VendorLedgerRelationalRepository extends VendorLedgerRepository {
  constructor(
    @InjectRepository(VendorLedgerEntryEntity)
    private readonly repo: Repository<VendorLedgerEntryEntity>,
  ) {
    super();
  }

  async create(input: CreateLedgerEntryInput): Promise<VendorLedgerEntry> {
    const ent = this.repo.create({
      vendorId: input.vendorId,
      type: input.type,
      amountMinor: input.amountMinor,
      currencyCode: input.currencyCode,
      availableAt: input.availableAt,
      subOrderId: input.subOrderId ?? null,
      returnId: input.returnId ?? null,
      payoutId: input.payoutId ?? null,
      adminUserId: input.adminUserId ?? null,
      memo: input.memo ?? null,
    });
    const saved = await this.repo.save(ent);
    return VendorLedgerEntryMapper.toDomain(saved);
  }

  async findByVendor(vendorId: string): Promise<VendorLedgerEntry[]> {
    const rows = await this.repo.find({ where: { vendorId } });
    return rows.map(VendorLedgerEntryMapper.toDomain);
  }

  async list(
    filter: ListLedgerFilter,
  ): Promise<{ data: VendorLedgerEntry[]; hasNextPage: boolean }> {
    const qb = this.repo
      .createQueryBuilder('e')
      .where('e.vendor_id = :vid', { vid: filter.vendorId });
    if (filter.type) qb.andWhere('e.type = :type', { type: filter.type });
    if (filter.from)
      qb.andWhere('e.created_at >= :from', { from: filter.from });
    if (filter.to) qb.andWhere('e.created_at <= :to', { to: filter.to });
    qb.orderBy('e.created_at', 'DESC')
      .skip((filter.page - 1) * filter.limit)
      .take(filter.limit + 1);
    const rows = await qb.getMany();
    const hasNextPage = rows.length > filter.limit;
    return {
      data: rows.slice(0, filter.limit).map(VendorLedgerEntryMapper.toDomain),
      hasNextPage,
    };
  }

  async findByPayout(payoutId: string): Promise<VendorLedgerEntry[]> {
    const rows = await this.repo.find({ where: { payoutId } });
    return rows.map(VendorLedgerEntryMapper.toDomain);
  }

  async findEarningForSubOrder(
    subOrderId: string,
  ): Promise<VendorLedgerEntry | null> {
    const row = await this.repo.findOne({
      where: { subOrderId, type: LedgerEntryType.EARNING },
    });
    return row ? VendorLedgerEntryMapper.toDomain(row) : null;
  }

  async findClawbackForReturn(
    returnId: string,
  ): Promise<VendorLedgerEntry | null> {
    const row = await this.repo.findOne({
      where: { returnId, type: LedgerEntryType.REFUND_CLAWBACK },
    });
    return row ? VendorLedgerEntryMapper.toDomain(row) : null;
  }
}
