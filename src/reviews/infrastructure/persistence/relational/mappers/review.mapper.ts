import { Review } from '../../../../domain/review';
import { ReviewEntity } from '../entities/review.entity';
import { ReviewMediaMapper } from './review-media.mapper';
import { VendorResponseMapper } from './vendor-response.mapper';

export class ReviewMapper {
  static toDomain(entity: ReviewEntity): Review {
    const d = new Review();
    d.id = entity.id;
    d.orderItemId = entity.orderItemId;
    d.productId = entity.productId;
    d.vendorId = entity.vendorId;
    d.buyerId = entity.buyerId;
    d.rating = entity.rating;
    d.body = entity.body;
    d.status = entity.status;
    d.media = (entity.media ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(ReviewMediaMapper.toDomain);
    d.vendorResponse = entity.vendorResponse
      ? VendorResponseMapper.toDomain(entity.vendorResponse)
      : null;
    // Buyer display name is filled in by the repository when needed for
    // public reads; default to null otherwise.
    d.buyerDisplayName = null;
    if (entity.buyer) {
      const u = entity.buyer as {
        firstName?: string | null;
        lastName?: string | null;
      };
      const parts = [u.firstName ?? '', u.lastName ?? ''].filter(
        (p) => p && p.trim(),
      );
      d.buyerDisplayName = parts.length ? parts.join(' ').trim() : null;
    }
    d.createdAt = entity.createdAt;
    d.updatedAt = entity.updatedAt;
    return d;
  }
}
