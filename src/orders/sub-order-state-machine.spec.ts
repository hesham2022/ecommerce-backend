import { UnprocessableEntityException } from '@nestjs/common';
import {
  OrderPaymentMethod,
  OrderPaymentStatus,
  SubOrderFulfillmentStatus,
} from './domain/order-enums';
import {
  assertBuyerCanConfirmDelivery,
  assertVendorTransition,
  canBuyerConfirmDelivery,
  canVendorTransition,
  isSubOrderVendorVisible,
  VendorTargetStatus,
} from './sub-order-state-machine';

describe('SubOrder state machine', () => {
  describe('canVendorTransition — happy path', () => {
    const happy: Array<[SubOrderFulfillmentStatus, VendorTargetStatus]> = [
      [
        SubOrderFulfillmentStatus.AWAITING_CONFIRMATION,
        SubOrderFulfillmentStatus.CONFIRMED,
      ],
      [SubOrderFulfillmentStatus.CONFIRMED, SubOrderFulfillmentStatus.PACKED],
      [SubOrderFulfillmentStatus.PACKED, SubOrderFulfillmentStatus.SHIPPED],
    ];

    it.each(happy)('should allow %s → %s', (from, to) => {
      expect(canVendorTransition(from, to)).toBe(true);
    });
  });

  describe('canVendorTransition — CANCELLED', () => {
    it('should allow CANCELLED from AWAITING_CONFIRMATION', () => {
      expect(
        canVendorTransition(
          SubOrderFulfillmentStatus.AWAITING_CONFIRMATION,
          SubOrderFulfillmentStatus.CANCELLED,
        ),
      ).toBe(true);
    });
    it('should allow CANCELLED from CONFIRMED', () => {
      expect(
        canVendorTransition(
          SubOrderFulfillmentStatus.CONFIRMED,
          SubOrderFulfillmentStatus.CANCELLED,
        ),
      ).toBe(true);
    });
    it('should allow CANCELLED from PACKED', () => {
      expect(
        canVendorTransition(
          SubOrderFulfillmentStatus.PACKED,
          SubOrderFulfillmentStatus.CANCELLED,
        ),
      ).toBe(true);
    });
    it('should reject CANCELLED from SHIPPED', () => {
      expect(
        canVendorTransition(
          SubOrderFulfillmentStatus.SHIPPED,
          SubOrderFulfillmentStatus.CANCELLED,
        ),
      ).toBe(false);
    });
    it('should reject CANCELLED from DELIVERED', () => {
      expect(
        canVendorTransition(
          SubOrderFulfillmentStatus.DELIVERED,
          SubOrderFulfillmentStatus.CANCELLED,
        ),
      ).toBe(false);
    });
  });

  describe('canVendorTransition — invalid jumps', () => {
    it('should reject skipping forward AWAITING → SHIPPED', () => {
      expect(
        canVendorTransition(
          SubOrderFulfillmentStatus.AWAITING_CONFIRMATION,
          SubOrderFulfillmentStatus.SHIPPED,
        ),
      ).toBe(false);
    });
    it('should reject backward CONFIRMED → AWAITING (vendor cannot un-confirm)', () => {
      expect(
        canVendorTransition(
          SubOrderFulfillmentStatus.CONFIRMED,
          SubOrderFulfillmentStatus.AWAITING_CONFIRMATION as unknown as VendorTargetStatus,
        ),
      ).toBe(false);
    });
    it('should reject backward SHIPPED → PACKED', () => {
      expect(
        canVendorTransition(
          SubOrderFulfillmentStatus.SHIPPED,
          SubOrderFulfillmentStatus.PACKED,
        ),
      ).toBe(false);
    });
    it('should not allow vendor to set DELIVERED (buyer-only)', () => {
      expect(
        canVendorTransition(
          SubOrderFulfillmentStatus.SHIPPED,
          SubOrderFulfillmentStatus.DELIVERED as unknown as VendorTargetStatus,
        ),
      ).toBe(false);
    });
  });

  describe('assertVendorTransition', () => {
    it('should throw 422 on invalid transition', () => {
      expect(() =>
        assertVendorTransition(
          SubOrderFulfillmentStatus.AWAITING_CONFIRMATION,
          SubOrderFulfillmentStatus.SHIPPED,
        ),
      ).toThrow(UnprocessableEntityException);
    });
    it('should return silently on valid transition', () => {
      expect(() =>
        assertVendorTransition(
          SubOrderFulfillmentStatus.AWAITING_CONFIRMATION,
          SubOrderFulfillmentStatus.CONFIRMED,
        ),
      ).not.toThrow();
    });
  });

  describe('canBuyerConfirmDelivery', () => {
    it('should allow only from SHIPPED', () => {
      expect(canBuyerConfirmDelivery(SubOrderFulfillmentStatus.SHIPPED)).toBe(
        true,
      );
    });
    it('should reject from PACKED, AWAITING, DELIVERED, CANCELLED', () => {
      for (const from of [
        SubOrderFulfillmentStatus.AWAITING_CONFIRMATION,
        SubOrderFulfillmentStatus.CONFIRMED,
        SubOrderFulfillmentStatus.PACKED,
        SubOrderFulfillmentStatus.DELIVERED,
        SubOrderFulfillmentStatus.CANCELLED,
      ]) {
        expect(canBuyerConfirmDelivery(from)).toBe(false);
      }
    });
    it('should throw 422 on assertion failure', () => {
      expect(() =>
        assertBuyerCanConfirmDelivery(SubOrderFulfillmentStatus.PACKED),
      ).toThrow(UnprocessableEntityException);
    });
  });
});

describe('isSubOrderVendorVisible', () => {
  it('should hide unpaid CARD orders from vendors', () => {
    expect(
      isSubOrderVendorVisible({
        paymentMethod: OrderPaymentMethod.CARD,
        paymentStatus: OrderPaymentStatus.PENDING,
      }),
    ).toBe(false);
  });

  it('should show paid CARD orders to vendors', () => {
    expect(
      isSubOrderVendorVisible({
        paymentMethod: OrderPaymentMethod.CARD,
        paymentStatus: OrderPaymentStatus.COLLECTED,
      }),
    ).toBe(true);
  });

  it('should always show COD orders to vendors regardless of payment status', () => {
    expect(
      isSubOrderVendorVisible({
        paymentMethod: OrderPaymentMethod.COD,
        paymentStatus: OrderPaymentStatus.PENDING,
      }),
    ).toBe(true);
  });

  it('should show COD orders even when collected', () => {
    expect(
      isSubOrderVendorVisible({
        paymentMethod: OrderPaymentMethod.COD,
        paymentStatus: OrderPaymentStatus.COLLECTED,
      }),
    ).toBe(true);
  });

  it('should hide failed CARD orders from vendors', () => {
    expect(
      isSubOrderVendorVisible({
        paymentMethod: OrderPaymentMethod.CARD,
        paymentStatus: OrderPaymentStatus.FAILED,
      }),
    ).toBe(false);
  });
});
