import { Review } from '../../domain/review';
import { ReviewStatus } from '../../domain/review-status';
import { VendorResponse } from '../../domain/vendor-response';

export interface CreateReviewRow {
  id: string;
  orderItemId: string;
  productId: string;
  vendorId: string;
  buyerId: number;
  rating: number;
  body: string;
  status: ReviewStatus;
  media: Array<{ id: string; fileId: string; position: number }>;
}

export interface ListPublicForProductOptions {
  productId: string;
  cursor?: string | null; // base64-encoded `${createdAtIso}|${id}`
  limit: number;
}

export interface PublicReviewListResult {
  data: Review[];
  nextCursor: string | null;
}

export interface ReviewSummary {
  count: number;
  average: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

export interface ListForVendorOptions {
  vendorId: string;
  status?: ReviewStatus;
  page: number;
  limit: number;
}

export interface VendorReviewListResult {
  data: Review[];
  total: number;
}

export abstract class ReviewAbstractRepository {
  abstract create(row: CreateReviewRow): Promise<Review>;
  abstract findById(id: string): Promise<Review | null>;
  abstract findByOrderItemId(orderItemId: string): Promise<Review | null>;
  abstract listPublicForProduct(
    opts: ListPublicForProductOptions,
  ): Promise<PublicReviewListResult>;
  abstract summaryForProduct(productId: string): Promise<ReviewSummary>;
  abstract listForVendor(
    opts: ListForVendorOptions,
  ): Promise<VendorReviewListResult>;
  abstract updateBuyerEditable(
    id: string,
    patch: { rating?: number; body?: string },
  ): Promise<Review>;
  abstract setStatus(id: string, status: ReviewStatus): Promise<Review>;
  abstract createVendorResponse(
    reviewId: string,
    body: string,
  ): Promise<VendorResponse>;
  abstract updateVendorResponse(
    reviewId: string,
    body: string,
  ): Promise<VendorResponse>;
  abstract findVendorResponse(reviewId: string): Promise<VendorResponse | null>;
}
