import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { ReviewAbstractRepository } from './infrastructure/persistence/review.abstract.repository';
import { OrderEntity } from '../orders/infrastructure/persistence/relational/entities/order.entity';
import { OrderItemEntity } from '../orders/infrastructure/persistence/relational/entities/order-item.entity';
import { SubOrderEntity } from '../orders/infrastructure/persistence/relational/entities/sub-order.entity';
import { ProductEntity } from '../products/infrastructure/persistence/relational/entities/product.entity';
import { FileEntity } from '../files/infrastructure/persistence/relational/entities/file.entity';
import { SubOrderFulfillmentStatus } from '../orders/domain/order-enums';
import { Review } from './domain/review';
import { ReviewStatus } from './domain/review-status';

describe('ReviewsService', () => {
  let service: ReviewsService;
  let reviewRepo: jest.Mocked<ReviewAbstractRepository>;
  let ordersRepo: { findOne: jest.Mock };
  let subOrdersRepo: { findOne: jest.Mock; update: jest.Mock };
  let orderItemsRepo: { findOne: jest.Mock };
  let productsRepo: { createQueryBuilder: jest.Mock };
  let filesRepo: { find: jest.Mock };

  const buildReview = (overrides: Partial<Review> = {}): Review => ({
    id: 'review-1',
    orderItemId: 'oi-1',
    productId: 'p-1',
    vendorId: 'v-1',
    buyerId: 7,
    rating: 5,
    body: 'Loved it.',
    status: ReviewStatus.PUBLISHED,
    media: [],
    vendorResponse: null,
    buyerDisplayName: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    ordersRepo = { findOne: jest.fn() };
    subOrdersRepo = { findOne: jest.fn(), update: jest.fn() };
    orderItemsRepo = { findOne: jest.fn() };
    productsRepo = { createQueryBuilder: jest.fn() };
    filesRepo = { find: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReviewsService,
        {
          provide: ReviewAbstractRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findByOrderItemId: jest.fn(),
            listPublicForProduct: jest.fn(),
            summaryForProduct: jest.fn(),
            listForVendor: jest.fn(),
            updateBuyerEditable: jest.fn(),
            setStatus: jest.fn(),
            createVendorResponse: jest.fn(),
            updateVendorResponse: jest.fn(),
            findVendorResponse: jest.fn(),
          },
        },
        { provide: getRepositoryToken(OrderEntity), useValue: ordersRepo },
        {
          provide: getRepositoryToken(SubOrderEntity),
          useValue: subOrdersRepo,
        },
        {
          provide: getRepositoryToken(OrderItemEntity),
          useValue: orderItemsRepo,
        },
        { provide: getRepositoryToken(ProductEntity), useValue: productsRepo },
        { provide: getRepositoryToken(FileEntity), useValue: filesRepo },
      ],
    }).compile();

    service = moduleRef.get(ReviewsService);
    reviewRepo = moduleRef.get(ReviewAbstractRepository);
  });

  describe('assertRatingInRange', () => {
    it('should accept integers 1 through 5', () => {
      for (const r of [1, 2, 3, 4, 5]) {
        expect(() => ReviewsService.assertRatingInRange(r)).not.toThrow();
      }
    });

    it('should reject 0', () => {
      expect(() => ReviewsService.assertRatingInRange(0)).toThrow(
        UnprocessableEntityException,
      );
    });

    it('should reject 6', () => {
      expect(() => ReviewsService.assertRatingInRange(6)).toThrow(
        UnprocessableEntityException,
      );
    });

    it('should reject fractional values', () => {
      expect(() => ReviewsService.assertRatingInRange(3.5)).toThrow(
        UnprocessableEntityException,
      );
    });

    it('should reject NaN/Infinity', () => {
      expect(() => ReviewsService.assertRatingInRange(NaN)).toThrow(
        UnprocessableEntityException,
      );
      expect(() => ReviewsService.assertRatingInRange(Infinity)).toThrow(
        UnprocessableEntityException,
      );
    });
  });

  describe('submitReview', () => {
    const buyerId = 7;
    const orderId = 'o-1';
    const subOrderId = 'so-1';
    const itemId = 'oi-1';

    function setHappyPath() {
      ordersRepo.findOne.mockResolvedValue({ id: orderId, buyerId });
      subOrdersRepo.findOne.mockResolvedValue({
        id: subOrderId,
        orderId,
        fulfillmentStatus: SubOrderFulfillmentStatus.DELIVERED,
      });
      orderItemsRepo.findOne.mockResolvedValue({
        id: itemId,
        subOrderId,
        productId: 'p-1',
        vendorId: 'v-1',
      });
      reviewRepo.findByOrderItemId.mockResolvedValue(null);
      reviewRepo.create.mockResolvedValue(buildReview());
    }

    it('should reject if order does not belong to caller', async () => {
      ordersRepo.findOne.mockResolvedValue({ id: orderId, buyerId: 99 });
      await expect(
        service.submitReview(buyerId, orderId, subOrderId, itemId, {
          rating: 5,
          body: 'x',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('should reject 404 if suborder is not under that order', async () => {
      ordersRepo.findOne.mockResolvedValue({ id: orderId, buyerId });
      subOrdersRepo.findOne.mockResolvedValue({
        id: subOrderId,
        orderId: 'o-other',
        fulfillmentStatus: SubOrderFulfillmentStatus.DELIVERED,
      });
      await expect(
        service.submitReview(buyerId, orderId, subOrderId, itemId, {
          rating: 5,
          body: 'x',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should reject 422 before DELIVERED', async () => {
      ordersRepo.findOne.mockResolvedValue({ id: orderId, buyerId });
      subOrdersRepo.findOne.mockResolvedValue({
        id: subOrderId,
        orderId,
        fulfillmentStatus: SubOrderFulfillmentStatus.SHIPPED,
      });
      await expect(
        service.submitReview(buyerId, orderId, subOrderId, itemId, {
          rating: 5,
          body: 'x',
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('should reject 422 for rating outside 1–5 (early)', async () => {
      ordersRepo.findOne.mockResolvedValue({ id: orderId, buyerId });
      await expect(
        service.submitReview(buyerId, orderId, subOrderId, itemId, {
          rating: 0,
          body: 'x',
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('should reject 409 on duplicate review', async () => {
      setHappyPath();
      reviewRepo.findByOrderItemId.mockResolvedValue(buildReview());
      await expect(
        service.submitReview(buyerId, orderId, subOrderId, itemId, {
          rating: 5,
          body: 'x',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('should create the review with denormalized productId + vendorId on happy path', async () => {
      setHappyPath();
      const result = await service.submitReview(
        buyerId,
        orderId,
        subOrderId,
        itemId,
        { rating: 5, body: 'great' },
      );
      expect(result.id).toBe('review-1');
      expect(reviewRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          orderItemId: itemId,
          productId: 'p-1',
          vendorId: 'v-1',
          buyerId,
          rating: 5,
          body: 'great',
          status: ReviewStatus.PUBLISHED,
          media: [],
        }),
      );
    });
  });

  describe('editOwnReview', () => {
    it('should block non-owners', async () => {
      reviewRepo.findById.mockResolvedValue(buildReview({ buyerId: 999 }));
      await expect(
        service.editOwnReview(7, 'review-1', { body: 'x' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('should block rating change after vendor responded', async () => {
      reviewRepo.findById.mockResolvedValue(
        buildReview({
          rating: 5,
          vendorResponse: {
            id: 'vr-1',
            reviewId: 'review-1',
            body: 'thanks',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
      );
      await expect(
        service.editOwnReview(7, 'review-1', { rating: 1 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('should allow body-only edits even after vendor responded', async () => {
      reviewRepo.findById.mockResolvedValue(
        buildReview({
          rating: 5,
          vendorResponse: {
            id: 'vr-1',
            reviewId: 'review-1',
            body: 'thanks',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
      );
      reviewRepo.updateBuyerEditable.mockResolvedValue(buildReview());
      await expect(
        service.editOwnReview(7, 'review-1', { body: 'edit' }),
      ).resolves.toBeDefined();
    });

    it('should reject edit after the 14-day window', async () => {
      const old = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
      reviewRepo.findById.mockResolvedValue(buildReview({ createdAt: old }));
      await expect(
        service.editOwnReview(7, 'review-1', { body: 'too late' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  describe('hideOwnReview', () => {
    it('should block if vendor has responded', async () => {
      reviewRepo.findById.mockResolvedValue(
        buildReview({
          vendorResponse: {
            id: 'vr-1',
            reviewId: 'review-1',
            body: 'x',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
      );
      await expect(service.hideOwnReview(7, 'review-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('should soft-hide otherwise', async () => {
      reviewRepo.findById.mockResolvedValue(buildReview());
      reviewRepo.setStatus.mockResolvedValue(
        buildReview({ status: ReviewStatus.HIDDEN }),
      );
      const out = await service.hideOwnReview(7, 'review-1');
      expect(reviewRepo.setStatus).toHaveBeenCalledWith(
        'review-1',
        ReviewStatus.HIDDEN,
      );
      expect(out.status).toBe(ReviewStatus.HIDDEN);
    });
  });

  describe('vendor responses', () => {
    it("should reject responding on another vendor's product (403)", async () => {
      reviewRepo.findById.mockResolvedValue(buildReview({ vendorId: 'v-1' }));
      await expect(
        service.createVendorResponse('v-OTHER', 'review-1', 'hi'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('should reject 409 on a second response', async () => {
      reviewRepo.findById.mockResolvedValue(
        buildReview({
          vendorId: 'v-1',
          vendorResponse: {
            id: 'vr-1',
            reviewId: 'review-1',
            body: 'first',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
      );
      await expect(
        service.createVendorResponse('v-1', 'review-1', 'second'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
