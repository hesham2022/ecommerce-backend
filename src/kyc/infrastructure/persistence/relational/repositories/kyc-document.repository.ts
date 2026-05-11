import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { VendorEntity } from '../../../../../vendors/infrastructure/persistence/relational/entities/vendor.entity';
import { KycDocument } from '../../../../domain/kyc-document';
import {
  KycDocumentStatus,
  KycDocumentType,
} from '../../../../domain/kyc-enums';
import {
  KycDocumentAbstractRepository,
  ListForAdminOptions,
  ListForVendorOptions,
  ListResult,
  ReviewKycDocumentInput,
  UploadKycDocumentInput,
} from '../../kyc-document.abstract.repository';
import { KycDocumentEntity } from '../entities/kyc-document.entity';
import { KycDocumentMapper } from '../mappers/kyc-document.mapper';

@Injectable()
export class KycDocumentRelationalRepository implements KycDocumentAbstractRepository {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(KycDocumentEntity)
    private readonly repo: Repository<KycDocumentEntity>,
  ) {}

  async upload(
    input: UploadKycDocumentInput,
    newVendorKycStatus: import('../../../../domain/kyc-enums').KycStatus,
  ): Promise<KycDocument> {
    return this.dataSource.transaction(async (em) => {
      const docRepo = em.getRepository(KycDocumentEntity);
      const vendorRepo = em.getRepository(VendorEntity);
      const now = new Date();

      // Mark any current (non-superseded) row of the same (vendor, type) as superseded.
      await docRepo.update(
        {
          vendorId: input.vendorId,
          type: input.type,
          supersededAt: IsNull(),
        },
        { supersededAt: now },
      );

      // Insert the new row.
      const row = docRepo.create({
        id: input.id,
        vendorId: input.vendorId,
        type: input.type,
        fileId: input.fileId,
        status: KycDocumentStatus.PENDING,
        details: input.details,
        rejectReason: null,
        supersededAt: null,
        submittedAt: now,
        reviewedAt: null,
        reviewedByUserId: null,
      });
      const saved = await docRepo.save(row);

      // Update vendor.kyc_status atomically.
      await vendorRepo.update({ id: input.vendorId }, {
        kycStatus: newVendorKycStatus,
      } as Partial<VendorEntity>);

      return KycDocumentMapper.toDomain(saved);
    });
  }

  async findById(id: string): Promise<KycDocument | null> {
    const row = await this.repo.findOne({ where: { id } });
    return row ? KycDocumentMapper.toDomain(row) : null;
  }

  async listForVendor(opts: ListForVendorOptions): Promise<KycDocument[]> {
    const qb = this.repo
      .createQueryBuilder('d')
      .where('d.vendor_id = :vendorId', { vendorId: opts.vendorId });
    if (opts.type) {
      qb.andWhere('d.type = :type', { type: opts.type });
    }
    if (!opts.includeSuperseded) {
      qb.andWhere('d.superseded_at IS NULL');
    }
    const rows = await qb.orderBy('d.submitted_at', 'DESC').getMany();
    return rows.map(KycDocumentMapper.toDomain);
  }

  async listForAdmin(opts: ListForAdminOptions): Promise<ListResult> {
    const offset = (opts.page - 1) * opts.limit;
    const qb = this.repo.createQueryBuilder('d');
    if (opts.vendorId) {
      qb.andWhere('d.vendor_id = :vendorId', { vendorId: opts.vendorId });
    }
    if (opts.status) {
      qb.andWhere('d.status = :status', { status: opts.status });
    }
    if (opts.currentOnly) {
      qb.andWhere('d.superseded_at IS NULL');
    }
    const [rows, total] = await qb
      .orderBy('d.submitted_at', 'DESC')
      .skip(offset)
      .take(opts.limit)
      .getManyAndCount();
    return { data: rows.map(KycDocumentMapper.toDomain), total };
  }

  async findCurrentByVendor(
    vendorId: string,
  ): Promise<Map<KycDocumentType, KycDocument>> {
    const rows = await this.repo.find({
      where: { vendorId, supersededAt: IsNull() },
    });
    const out = new Map<KycDocumentType, KycDocument>();
    for (const row of rows) {
      out.set(row.type, KycDocumentMapper.toDomain(row));
    }
    return out;
  }

  async review(input: ReviewKycDocumentInput): Promise<KycDocument> {
    return this.dataSource.transaction(async (em) => {
      const docRepo = em.getRepository(KycDocumentEntity);
      const vendorRepo = em.getRepository(VendorEntity);
      const row = await docRepo.findOne({ where: { id: input.id } });
      if (!row) throw new NotFoundException(`Document ${input.id} not found`);
      if (row.vendorId !== input.vendorId) {
        throw new NotFoundException(`Document ${input.id} not found`);
      }
      if (row.supersededAt !== null) {
        throw new UnprocessableEntityException(
          'Cannot review a superseded document',
        );
      }
      if (row.status !== KycDocumentStatus.PENDING) {
        throw new UnprocessableEntityException(
          `Cannot review a document in status ${row.status}`,
        );
      }
      row.status = input.status;
      row.rejectReason = input.rejectReason;
      row.reviewedAt = input.reviewedAt;
      row.reviewedByUserId = input.reviewedByUserId;
      await docRepo.save(row);
      await vendorRepo.update({ id: input.vendorId }, {
        kycStatus: input.newVendorKycStatus,
      } as Partial<VendorEntity>);
      return KycDocumentMapper.toDomain(row);
    });
  }
}
