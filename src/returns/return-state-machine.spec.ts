import { ReturnStatus } from './domain/return-enums';
import {
  assertBuyerTransition,
  assertVendorTransition,
  canBuyerTransition,
  canVendorTransition,
} from './return-state-machine';
import { UnprocessableEntityException } from '@nestjs/common';

describe('return-state-machine', () => {
  describe('canVendorTransition', () => {
    it('should allow REQUESTED -> APPROVED', () => {
      expect(
        canVendorTransition(ReturnStatus.REQUESTED, ReturnStatus.APPROVED),
      ).toBe(true);
    });

    it('should allow REQUESTED -> REJECTED', () => {
      expect(
        canVendorTransition(ReturnStatus.REQUESTED, ReturnStatus.REJECTED),
      ).toBe(true);
    });

    it('should allow SHIPPED_BACK -> RECEIVED', () => {
      expect(
        canVendorTransition(ReturnStatus.SHIPPED_BACK, ReturnStatus.RECEIVED),
      ).toBe(true);
    });

    it('should allow RECEIVED -> REFUNDED', () => {
      expect(
        canVendorTransition(ReturnStatus.RECEIVED, ReturnStatus.REFUNDED),
      ).toBe(true);
    });

    it('should allow RECEIVED -> REJECTED', () => {
      expect(
        canVendorTransition(ReturnStatus.RECEIVED, ReturnStatus.REJECTED),
      ).toBe(true);
    });

    it('should allow REFUNDED -> CLOSED', () => {
      expect(
        canVendorTransition(ReturnStatus.REFUNDED, ReturnStatus.CLOSED),
      ).toBe(true);
    });

    it('should reject vendor SHIPPED_BACK transition (buyer-only)', () => {
      expect(
        canVendorTransition(ReturnStatus.APPROVED, ReturnStatus.SHIPPED_BACK),
      ).toBe(false);
    });

    it('should reject forward skip REQUESTED -> RECEIVED', () => {
      expect(
        canVendorTransition(ReturnStatus.REQUESTED, ReturnStatus.RECEIVED),
      ).toBe(false);
    });

    it('should reject backward APPROVED -> REQUESTED', () => {
      expect(
        canVendorTransition(ReturnStatus.APPROVED, ReturnStatus.REQUESTED),
      ).toBe(false);
    });

    it('should reject any transition out of CLOSED', () => {
      expect(
        canVendorTransition(ReturnStatus.CLOSED, ReturnStatus.REFUNDED),
      ).toBe(false);
    });

    it('should reject any transition out of REJECTED', () => {
      expect(
        canVendorTransition(ReturnStatus.REJECTED, ReturnStatus.APPROVED),
      ).toBe(false);
    });
  });

  describe('canBuyerTransition', () => {
    it('should allow APPROVED -> SHIPPED_BACK', () => {
      expect(
        canBuyerTransition(ReturnStatus.APPROVED, ReturnStatus.SHIPPED_BACK),
      ).toBe(true);
    });

    it('should reject any other buyer transition', () => {
      expect(
        canBuyerTransition(ReturnStatus.REQUESTED, ReturnStatus.APPROVED),
      ).toBe(false);
      expect(
        canBuyerTransition(ReturnStatus.SHIPPED_BACK, ReturnStatus.RECEIVED),
      ).toBe(false);
    });
  });

  describe('assertVendorTransition', () => {
    it('should throw for invalid transition', () => {
      expect(() =>
        assertVendorTransition(ReturnStatus.REQUESTED, ReturnStatus.RECEIVED),
      ).toThrow(UnprocessableEntityException);
    });

    it('should not throw for valid transition', () => {
      expect(() =>
        assertVendorTransition(ReturnStatus.REQUESTED, ReturnStatus.APPROVED),
      ).not.toThrow();
    });
  });

  describe('assertBuyerTransition', () => {
    it('should throw for invalid transition', () => {
      expect(() =>
        assertBuyerTransition(ReturnStatus.REQUESTED, ReturnStatus.APPROVED),
      ).toThrow(UnprocessableEntityException);
    });

    it('should not throw for valid transition', () => {
      expect(() =>
        assertBuyerTransition(ReturnStatus.APPROVED, ReturnStatus.SHIPPED_BACK),
      ).not.toThrow();
    });
  });
});
