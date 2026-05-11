import {
  KycDocumentStatus,
  KycDocumentType,
  KycStatus,
} from './domain/kyc-enums';

export const KYC_REQUIRED_TYPES: ReadonlyArray<KycDocumentType> = [
  KycDocumentType.COMMERCIAL_REGISTRATION,
  KycDocumentType.TAX_CERTIFICATE,
  KycDocumentType.IBAN_DOCUMENT,
  KycDocumentType.OWNER_ID,
];

export const KYC_EXPIRY_WARNING_DAYS = 30;

/**
 * Compute the aggregate KycStatus for a vendor given the current (non-superseded)
 * document statuses, indexed by type.
 *
 * Rules, in order:
 *   1. Any required type without a current doc → NOT_SUBMITTED
 *   2. Any required type with REJECTED current doc → REJECTED (rejection wins)
 *   3. Any required type with PENDING current doc → PENDING_REVIEW
 *   4. Otherwise (all required APPROVED) → APPROVED
 *
 * Types not in `requiredTypes` are ignored.
 */
export function computeKycStatus(
  requiredTypes: ReadonlyArray<KycDocumentType>,
  currentDocsByType: Map<KycDocumentType, KycDocumentStatus>,
): KycStatus {
  const requiredStatuses: KycDocumentStatus[] = [];
  for (const t of requiredTypes) {
    const s = currentDocsByType.get(t);
    if (s === undefined) return KycStatus.NOT_SUBMITTED;
    requiredStatuses.push(s);
  }
  if (requiredStatuses.some((s) => s === KycDocumentStatus.REJECTED)) {
    return KycStatus.REJECTED;
  }
  if (requiredStatuses.some((s) => s === KycDocumentStatus.PENDING)) {
    return KycStatus.PENDING_REVIEW;
  }
  return KycStatus.APPROVED;
}
