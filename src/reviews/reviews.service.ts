import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { uuidv7Generate } from '../utils/uuid';
import { OrderItemEntity } from '../orders/infrastructure/persistence/relational/entities/order-item.entity';
import { OrderEntity } from '../orders/infrastructure/persistence/relational/entities/order.entity';
import { SubOrderEntity } from '../orders/infrastructure/persistence/relational/entities/sub-order.entity';
import { SubOrderFulfillmentStatus } from '../orders/domain/order-enums';
import { ProductEntity } from '../products/infrastructure/persistence/relational/entities/product.entity';
import { FileEntity } from '../files/infrastructure/persistence/relational/entities/file.entity';
import { Review } from './domain/review';
import { ReviewStatus } from './domain/review-status';
import { VendorResponse } from './domain/vendor-response';
import {
  PublicReviewListResult,
  ReviewAbstractRepository,
  ReviewSummary,
  VendorReviewListResult,
} from './infrastructure/persistence/review.abstract.repository';

const EDIT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export interface SubmitReviewInput {
  rating: number;
  body: string;
  mediaFileIds?: string[];
}

export interface UpdateReviewInput {
  rating?: number;
  body?: string;
}

@Injectable()
export class ReviewsService {
  constructor(
    private readonly reviewRepo: ReviewAbstractRepository,
    @InjectRepository(OrderEntity)
    private readonly ordersRepo: Repository<OrderEntity>,
    @InjectRepository(SubOrderEntity)
    private readonly subOrdersRepo: Repository<SubOrderEntity>,
    @InjectRepository(OrderItemEntity)
    private readonly orderItemsRepo: Repository<OrderItemEntity>,
    @InjectRepository(ProductEntity)
    private readonly productsRepo: Repository<ProductEntity>,
    @InjectRepository(FileEntity)
    private readonly filesRepo: Repository<FileEntity>,
  ) {}

  /**
   * Public-facing rating-bounds check. Lifted out so the rule has a unit
   * test even when the DB isn't running.
   */
  static assertRatingInRange(rating: number): void {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new UnprocessableEntityException(
        'rating must be an integer between 1 and 5',
      );
    }
  }

  // ── Buyer ───────────────────────────────────────────────────────────

  async submitReview(
    buyerId: number,
    orderId: string,
    subOrderId: string,
    orderItemId: string,
    input: SubmitReviewInput,
  ): Promise<Review> {
    ReviewsService.assertRatingInRange(input.rating);

    // Order must exist + belong to caller
    const order = await this.ordersRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.buyerId !== buyerId) {
      throw new ForbiddenException('You do not own this order');
    }

    // SubOrder must exist + belong to that order, and be DELIVERED
    const subOrder = await this.subOrdersRepo.findOne({
      where: { id: subOrderId },
    });
    if (!subOrder || subOrder.orderId !== orderId) {
      throw new NotFoundException('SubOrder not found');
    }
    if (subOrder.fulfillmentStatus !== SubOrderFulfillmentStatus.DELIVERED) {
      throw new UnprocessableEntityException(
        'You can only review items that have been delivered',
      );
    }

    // OrderItem must exist + belong to that suborder
    const item = await this.orderItemsRepo.findOne({
      where: { id: orderItemId },
    });
    if (!item || item.subOrderId !== subOrderId) {
      throw new NotFoundException('Order item not found');
    }

    // No prior review (UNIQUE in DB; we check first for a friendlier 409).
    const existing = await this.reviewRepo.findByOrderItemId(orderItemId);
    if (existing) {
      throw new ConflictException('Review already submitted for this item');
    }

    // Validate media file IDs (if any) exist in the files table.
    const mediaInputs = await this.resolveMediaFileIds(input.mediaFileIds);

    return this.reviewRepo.create({
      id: uuidv7Generate(),
      orderItemId,
      productId: item.productId,
      vendorId: item.vendorId,
      buyerId,
      rating: input.rating,
      body: input.body,
      status: ReviewStatus.PUBLISHED,
      media: mediaInputs.map((m, i) => ({
        id: uuidv7Generate(),
        fileId: m.id,
        position: i,
      })),
    });
  }

  private async resolveMediaFileIds(
    fileIds?: string[],
  ): Promise<Array<{ id: string }>> {
    if (!fileIds || fileIds.length === 0) return [];
    const dedup = Array.from(new Set(fileIds));
    const found = await this.filesRepo.find({
      where: dedup.map((id) => ({ id })),
    });
    if (found.length !== dedup.length) {
      throw new UnprocessableEntityException(
        'One or more mediaFileIds reference unknown files',
      );
    }
    // Preserve the caller's order.
    const byId = new Map(found.map((f) => [f.id, f]));
    return dedup
      .map((id) => byId.get(id))
      .filter((f): f is NonNullable<typeof f> => !!f);
  }

  async editOwnReview(
    buyerId: number,
    reviewId: string,
    input: UpdateReviewInput,
  ): Promise<Review> {
    const existing = await this.reviewRepo.findById(reviewId);
    if (!existing) throw new NotFoundException('Review not found');
    if (existing.buyerId !== buyerId) {
      throw new ForbiddenException('You can only edit your own review');
    }
    if (existing.status !== ReviewStatus.PUBLISHED) {
      throw new UnprocessableEntityException(
        'Hidden or reported reviews cannot be edited',
      );
    }

    const ageMs = Date.now() - new Date(existing.createdAt).getTime();
    if (ageMs > EDIT_WINDOW_MS) {
      throw new UnprocessableEntityException(
        'Reviews can only be edited within 14 days of creation',
      );
    }

    if (input.rating !== undefined) {
      ReviewsService.assertRatingInRange(input.rating);
      // Once the vendor has responded, the rating is locked. Body edits OK.
      const ratingChanged = input.rating !== existing.rating;
      if (ratingChanged && existing.vendorResponse) {
        throw new ConflictException(
          'Rating cannot be changed after vendor has responded',
        );
      }
    }

    return this.reviewRepo.updateBuyerEditable(reviewId, input);
  }

  async hideOwnReview(buyerId: number, reviewId: string): Promise<Review> {
    const existing = await this.reviewRepo.findById(reviewId);
    if (!existing) throw new NotFoundException('Review not found');
    if (existing.buyerId !== buyerId) {
      throw new ForbiddenException('You can only delete your own review');
    }
    if (existing.vendorResponse) {
      throw new ConflictException(
        'Reviews with a vendor response cannot be deleted',
      );
    }
    return this.reviewRepo.setStatus(reviewId, ReviewStatus.HIDDEN);
  }

  // ── Public reads ────────────────────────────────────────────────────

  async listPublicForProduct(
    vendorSlug: string,
    productSlug: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<PublicReviewListResult> {
    const product = await this.findProductBySlug(vendorSlug, productSlug);
    return this.reviewRepo.listPublicForProduct({
      productId: product.id,
      cursor: cursor ?? null,
      limit,
    });
  }

  async summaryForProduct(
    vendorSlug: string,
    productSlug: string,
  ): Promise<ReviewSummary> {
    const product = await this.findProductBySlug(vendorSlug, productSlug);
    return this.reviewRepo.summaryForProduct(product.id);
  }

  private async findProductBySlug(
    vendorSlug: string,
    productSlug: string,
  ): Promise<{ id: string }> {
    const row = await this.productsRepo
      .createQueryBuilder('p')
      .innerJoin('vendor', 'v', 'v.id = p.vendor_id')
      .where('v.slug = :vs', { vs: vendorSlug })
      .andWhere('p.slug = :ps', { ps: productSlug })
      .select(['p.id AS id'])
      .getRawOne<{ id: string }>();
    if (!row) throw new NotFoundException('Product not found');
    return row;
  }

  // ── Vendor side ─────────────────────────────────────────────────────

  async listForVendor(
    vendorId: string,
    opts: { status?: ReviewStatus; page?: number; limit?: number },
  ): Promise<VendorReviewListResult> {
    const page = opts.page ?? 1;
    const limit = Math.min(opts.limit ?? 20, 100);
    return this.reviewRepo.listForVendor({
      vendorId,
      status: opts.status,
      page,
      limit,
    });
  }

  async createVendorResponse(
    vendorId: string,
    reviewId: string,
    body: string,
  ): Promise<VendorResponse> {
    const review = await this.reviewRepo.findById(reviewId);
    if (!review) throw new NotFoundException('Review not found');
    if (review.vendorId !== vendorId) {
      throw new ForbiddenException(
        'You can only respond to reviews of your own products',
      );
    }
    if (review.vendorResponse) {
      throw new ConflictException('You have already responded to this review');
    }
    return this.reviewRepo.createVendorResponse(reviewId, body);
  }

  async updateVendorResponse(
    vendorId: string,
    reviewId: string,
    body: string,
  ): Promise<VendorResponse> {
    const review = await this.reviewRepo.findById(reviewId);
    if (!review) throw new NotFoundException('Review not found');
    if (review.vendorId !== vendorId) {
      throw new ForbiddenException(
        'You can only edit responses on your own products',
      );
    }
    if (!review.vendorResponse) {
      throw new NotFoundException('No response exists yet');
    }
    return this.reviewRepo.updateVendorResponse(reviewId, body);
  }

  // ── Admin moderation ────────────────────────────────────────────────

  async setStatus(reviewId: string, status: ReviewStatus): Promise<Review> {
    const existing = await this.reviewRepo.findById(reviewId);
    if (!existing) throw new NotFoundException('Review not found');
    return this.reviewRepo.setStatus(reviewId, status);
  }

  /**
   * Admin/test helper: mark a SubOrder as DELIVERED. The dedicated
   * fulfillment slice (phase 5) owns the buyer-/vendor-facing transitions;
   * this is the back-office override that lets QA and tests build review
   * fixtures without depending on phase-5 code.
   */
  async adminSetSubOrderFulfillmentStatus(
    subOrderId: string,
    status: SubOrderFulfillmentStatus,
  ): Promise<{ id: string; fulfillmentStatus: SubOrderFulfillmentStatus }> {
    const existing = await this.subOrdersRepo.findOne({
      where: { id: subOrderId },
    });
    if (!existing) throw new NotFoundException('SubOrder not found');
    const update: Partial<SubOrderEntity> = { fulfillmentStatus: status };
    if (
      status === SubOrderFulfillmentStatus.DELIVERED &&
      !existing.deliveredAt
    ) {
      update.deliveredAt = new Date();
    }
    await this.subOrdersRepo.update({ id: subOrderId }, update);
    return { id: subOrderId, fulfillmentStatus: status };
  }
}
