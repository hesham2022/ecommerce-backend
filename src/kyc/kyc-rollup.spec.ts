import { computeKycStatus, KYC_REQUIRED_TYPES } from './kyc-rollup';
import {
  KycDocumentStatus,
  KycDocumentType,
  KycStatus,
} from './domain/kyc-enums';

describe('kyc-rollup', () => {
  it('should return NOT_SUBMITTED when no docs exist', () => {
    expect(computeKycStatus(KYC_REQUIRED_TYPES, new Map())).toBe(
      KycStatus.NOT_SUBMITTED,
    );
  });

  it('should return NOT_SUBMITTED when some required types are missing', () => {
    const current = new Map([
      [KycDocumentType.COMMERCIAL_REGISTRATION, KycDocumentStatus.APPROVED],
      [KycDocumentType.TAX_CERTIFICATE, KycDocumentStatus.APPROVED],
      // IBAN_DOCUMENT and OWNER_ID missing
    ]);
    expect(computeKycStatus(KYC_REQUIRED_TYPES, current)).toBe(
      KycStatus.NOT_SUBMITTED,
    );
  });

  it('should return APPROVED when all required are APPROVED', () => {
    const current = new Map([
      [KycDocumentType.COMMERCIAL_REGISTRATION, KycDocumentStatus.APPROVED],
      [KycDocumentType.TAX_CERTIFICATE, KycDocumentStatus.APPROVED],
      [KycDocumentType.IBAN_DOCUMENT, KycDocumentStatus.APPROVED],
      [KycDocumentType.OWNER_ID, KycDocumentStatus.APPROVED],
    ]);
    expect(computeKycStatus(KYC_REQUIRED_TYPES, current)).toBe(
      KycStatus.APPROVED,
    );
  });

  it('should return PENDING_REVIEW when all present but one is PENDING', () => {
    const current = new Map([
      [KycDocumentType.COMMERCIAL_REGISTRATION, KycDocumentStatus.APPROVED],
      [KycDocumentType.TAX_CERTIFICATE, KycDocumentStatus.PENDING],
      [KycDocumentType.IBAN_DOCUMENT, KycDocumentStatus.APPROVED],
      [KycDocumentType.OWNER_ID, KycDocumentStatus.APPROVED],
    ]);
    expect(computeKycStatus(KYC_REQUIRED_TYPES, current)).toBe(
      KycStatus.PENDING_REVIEW,
    );
  });

  it('should return REJECTED when any required doc is REJECTED', () => {
    const current = new Map([
      [KycDocumentType.COMMERCIAL_REGISTRATION, KycDocumentStatus.APPROVED],
      [KycDocumentType.TAX_CERTIFICATE, KycDocumentStatus.REJECTED],
      [KycDocumentType.IBAN_DOCUMENT, KycDocumentStatus.APPROVED],
      [KycDocumentType.OWNER_ID, KycDocumentStatus.PENDING],
    ]);
    expect(computeKycStatus(KYC_REQUIRED_TYPES, current)).toBe(
      KycStatus.REJECTED,
    );
  });

  it('should return REJECTED even when PENDING also present (rejection wins)', () => {
    const current = new Map([
      [KycDocumentType.COMMERCIAL_REGISTRATION, KycDocumentStatus.PENDING],
      [KycDocumentType.TAX_CERTIFICATE, KycDocumentStatus.REJECTED],
      [KycDocumentType.IBAN_DOCUMENT, KycDocumentStatus.PENDING],
      [KycDocumentType.OWNER_ID, KycDocumentStatus.PENDING],
    ]);
    expect(computeKycStatus(KYC_REQUIRED_TYPES, current)).toBe(
      KycStatus.REJECTED,
    );
  });

  it('should ignore non-required types in the current map', () => {
    // (hypothetical extra type, not in REQUIRED_TYPES — should be ignored)
    const current = new Map([
      [KycDocumentType.COMMERCIAL_REGISTRATION, KycDocumentStatus.APPROVED],
      [KycDocumentType.TAX_CERTIFICATE, KycDocumentStatus.APPROVED],
      [KycDocumentType.IBAN_DOCUMENT, KycDocumentStatus.APPROVED],
      [KycDocumentType.OWNER_ID, KycDocumentStatus.APPROVED],
    ]);
    expect(computeKycStatus(KYC_REQUIRED_TYPES, current)).toBe(
      KycStatus.APPROVED,
    );
  });
});
