import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { uuidv7Generate } from '../../../../../utils/uuid';
import { Review } from '../../../../domain/review';
import { ReviewStatus } from '../../../../domain/review-status';
import { VendorResponse } from '../../../../domain/vendor-response';
import {
  CreateReviewRow,
  ListForVendorOptions,
  ListPublicForProductOptions,
  PublicReviewListResult,
  ReviewAbstractRepository,
  ReviewSummary,
  VendorReviewListResult,
} from '../../review.abstract.repository';
import { ReviewEntity } from '../entities/review.entity';
import { ReviewMediaEntity } from '../entities/review-media.entity';
import { VendorResponseEntity } from '../entities/vendor-response.entity';
// ReviewMediaEntity is referenced via getRepository(ReviewMediaEntity) inside
// the create() transaction below.
import { ReviewMapper } from '../mappers/review.mapper';
import { VendorResponseMapper } from '../mappers/vendor-response.mapper';

const RELATIONS = ['media', 'media.file', 'vendorResponse', 'buyer'] as const;

interface CursorPayload {
  createdAt: string;
  id: string;
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): CursorPayload | null {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const obj = JSON.parse(json) as CursorPayload;
    if (typeof obj.createdAt === 'string' && typeof obj.id === 'string') {
      return obj;
    }
    return null;
  } catch {
    return null;
  }
}

@Injectable()
export class ReviewRelationalRepository implements ReviewAbstractRepository {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(ReviewEntity)
    private readonly reviewRepo: Repository<ReviewEntity>,
    @InjectRepository(VendorResponseEntity)
    private readonly vrRepo: Repository<VendorResponseEntity>,
  ) {}

  async create(row: CreateReviewRow): Promise<Review> {
    return this.dataSource.transaction(async (em) => {
      const reviewRepo = em.getRepository(ReviewEntity);
      const mediaRepo = em.getRepository(ReviewMediaEntity);
      const review = reviewRepo.create({
        id: row.id,
        orderItemId: row.orderItemId,
        productId: row.productId,
        vendorId: row.vendorId,
        buyerId: row.buyerId,
        rating: row.rating,
        body: row.body,
        status: row.status,
      });
      await reviewRepo.save(review);
      if (row.media.length > 0) {
        await mediaRepo.save(
          row.media.map((m) =>
            mediaRepo.create({
              id: m.id,
              reviewId: row.id,
              fileId: m.fileId,
              position: m.position,
            }),
          ),
        );
      }
      const reloaded = await reviewRepo.findOne({
        where: { id: row.id },
        relations: RELATIONS as unknown as string[],
      });
      if (!reloaded) throw new NotFoundException('Review vanished after write');
      return ReviewMapper.toDomain(reloaded);
    });
  }

  async findById(id: string): Promise<Review | null> {
    const row = await this.reviewRepo.findOne({
      where: { id },
      relations: RELATIONS as unknown as string[],
    });
    return row ? ReviewMapper.toDomain(row) : null;
  }

  async findByOrderItemId(orderItemId: string): Promise<Review | null> {
    const row = await this.reviewRepo.findOne({
      where: { orderItemId },
      relations: RELATIONS as unknown as string[],
    });
    return row ? ReviewMapper.toDomain(row) : null;
  }

  async listPublicForProduct(
    opts: ListPublicForProductOptions,
  ): Promise<PublicReviewListResult> {
    const limit = Math.min(Math.max(opts.limit, 1), 50);
    const qb = this.reviewRepo
      .createQueryBuilder('r')
      .where('r.product_id = :pid', { pid: opts.productId })
      .andWhere('r.status = :status', { status: ReviewStatus.PUBLISHED });

    if (opts.cursor) {
      const cur = decodeCursor(opts.cursor);
      if (cur) {
        qb.andWhere('(r.created_at, r.id) < (:cAt, :cId)', {
          cAt: cur.createdAt,
          cId: cur.id,
        });
      }
    }

    qb.orderBy('r.created_at', 'DESC')
      .addOrderBy('r.id', 'DESC')
      .take(limit + 1);

    const idRows = await qb.getMany();
    const hasMore = idRows.length > limit;
    const pageRows = hasMore ? idRows.slice(0, limit) : idRows;

    if (pageRows.length === 0) {
      return { data: [], nextCursor: null };
    }

    // Hydrate the page in one pass with the full set of relations.
    const ids = pageRows.map((r) => r.id);
    const hydrated = await this.reviewRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.media', 'm')
      .leftJoinAndSelect('m.file', 'mf')
      .leftJoinAndSelect('r.vendorResponse', 'vr')
      .leftJoinAndSelect('r.buyer', 'b')
      .where('r.id IN (:...ids)', { ids })
      .orderBy('r.created_at', 'DESC')
      .addOrderBy('r.id', 'DESC')
      .getMany();

    const byId = new Map(hydrated.map((h) => [h.id, h]));
    const ordered = ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => !!r);

    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore
      ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
      : null;

    return { data: ordered.map(ReviewMapper.toDomain), nextCursor };
  }

  async summaryForProduct(productId: string): Promise<ReviewSummary> {
    const rows = await this.reviewRepo
      .createQueryBuilder('r')
      .select('r.rating', 'rating')
      .addSelect('COUNT(*)::int', 'count')
      .where('r.product_id = :pid', { pid: productId })
      .andWhere('r.status = :status', { status: ReviewStatus.PUBLISHED })
      .groupBy('r.rating')
      .getRawMany<{ rating: number; count: number }>();

    const distribution: Record<1 | 2 | 3 | 4 | 5, number> = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    };
    let count = 0;
    let sum = 0;
    for (const r of rows) {
      const k = Number(r.rating) as 1 | 2 | 3 | 4 | 5;
      const c = Number(r.count);
      if (k >= 1 && k <= 5) distribution[k] = c;
      count += c;
      sum += k * c;
    }
    const average = count > 0 ? Math.round((sum / count) * 100) / 100 : 0;
    return { count, average, distribution };
  }

  async listForVendor(
    opts: ListForVendorOptions,
  ): Promise<VendorReviewListResult> {
    const offset = (opts.page - 1) * opts.limit;
    const baseQb = this.reviewRepo
      .createQueryBuilder('r')
      .where('r.vendor_id = :vid', { vid: opts.vendorId });
    if (opts.status) {
      baseQb.andWhere('r.status = :status', { status: opts.status });
    }
    const [idRows, total] = await baseQb
      .orderBy('r.created_at', 'DESC')
      .addOrderBy('r.id', 'DESC')
      .skip(offset)
      .take(opts.limit)
      .getManyAndCount();

    if (idRows.length === 0) return { data: [], total };

    const ids = idRows.map((r) => r.id);
    const hydrated = await this.reviewRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.media', 'm')
      .leftJoinAndSelect('m.file', 'mf')
      .leftJoinAndSelect('r.vendorResponse', 'vr')
      .leftJoinAndSelect('r.buyer', 'b')
      .where('r.id IN (:...ids)', { ids })
      .orderBy('r.created_at', 'DESC')
      .addOrderBy('r.id', 'DESC')
      .getMany();

    const byId = new Map(hydrated.map((h) => [h.id, h]));
    const ordered = ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => !!r);

    return { data: ordered.map(ReviewMapper.toDomain), total };
  }

  async updateBuyerEditable(
    id: string,
    patch: { rating?: number; body?: string },
  ): Promise<Review> {
    const update: Partial<ReviewEntity> = {};
    if (patch.rating !== undefined) update.rating = patch.rating;
    if (patch.body !== undefined) update.body = patch.body;
    if (Object.keys(update).length > 0) {
      await this.reviewRepo.update({ id }, update);
    }
    const row = await this.reviewRepo.findOne({
      where: { id },
      relations: RELATIONS as unknown as string[],
    });
    if (!row) throw new NotFoundException('Review not found after update');
    return ReviewMapper.toDomain(row);
  }

  async setStatus(id: string, status: ReviewStatus): Promise<Review> {
    await this.reviewRepo.update({ id }, { status });
    const row = await this.reviewRepo.findOne({
      where: { id },
      relations: RELATIONS as unknown as string[],
    });
    if (!row)
      throw new NotFoundException('Review not found after status change');
    return ReviewMapper.toDomain(row);
  }

  async createVendorResponse(
    reviewId: string,
    body: string,
  ): Promise<VendorResponse> {
    const created = this.vrRepo.create({
      id: uuidv7Generate(),
      reviewId,
      body,
    });
    await this.vrRepo.save(created);
    return VendorResponseMapper.toDomain(created);
  }

  async updateVendorResponse(
    reviewId: string,
    body: string,
  ): Promise<VendorResponse> {
    await this.vrRepo.update({ reviewId }, { body });
    const row = await this.vrRepo.findOneOrFail({ where: { reviewId } });
    return VendorResponseMapper.toDomain(row);
  }

  async findVendorResponse(reviewId: string): Promise<VendorResponse | null> {
    const row = await this.vrRepo.findOne({ where: { reviewId } });
    return row ? VendorResponseMapper.toDomain(row) : null;
  }
}
