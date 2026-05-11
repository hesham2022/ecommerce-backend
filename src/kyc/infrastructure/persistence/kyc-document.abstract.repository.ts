import { KycDocument } from '../../domain/kyc-document';
import { KycDocumentStatus, KycDocumentType } from '../../domain/kyc-enums';

export interface UploadKycDocumentInput {
  id: string;
  vendorId: string;
  type: KycDocumentType;
  fileId: string;
  details: Record<string, unknown>;
}

export interface ReviewKycDocumentInput {
  id: string;
  vendorId: string;
  status: KycDocumentStatus; // APPROVED or REJECTED
  rejectReason: string | null;
  reviewedByUserId: number;
  reviewedAt: Date;
  /**
   * Updated aggregate kyc_status for the vendor, computed by the service in
   * the same transaction. The repository writes this to `vendor.kyc_status`
   * inside the transaction so the rollup is atomic with the per-doc change.
   */
  newVendorKycStatus: import('../../domain/kyc-enums').KycStatus;
}

export interface ListForVendorOptions {
  vendorId: string;
  type?: KycDocumentType;
  includeSuperseded: boolean;
}

export interface ListForAdminOptions {
  status?: KycDocumentStatus;
  vendorId?: string;
  page: number;
  limit: number;
  currentOnly: boolean;
}

export interface ListResult {
  data: KycDocument[];
  total: number;
}

export abstract class KycDocumentAbstractRepository {
  /**
   * Insert a new kyc_document row. If a current (non-superseded) row of the
   * same (vendorId, type) exists, mark it superseded_at = now() in the same
   * transaction. Also writes the new aggregate vendor.kyc_status atomically.
   */
  abstract upload(
    input: UploadKycDocumentInput,
    newVendorKycStatus: import('../../domain/kyc-enums').KycStatus,
  ): Promise<KycDocument>;

  abstract findById(id: string): Promise<KycDocument | null>;

  abstract listForVendor(opts: ListForVendorOptions): Promise<KycDocument[]>;

  abstract listForAdmin(opts: ListForAdminOptions): Promise<ListResult>;

  /**
   * Returns the current (non-superseded) docs for a vendor, indexed by type.
   * Used by the service to compute the rollup before any write.
   */
  abstract findCurrentByVendor(
    vendorId: string,
  ): Promise<Map<KycDocumentType, KycDocument>>;

  /**
   * Approve or reject a document and update vendor.kyc_status in the same
   * transaction. Throws if the target doc is not in PENDING status or is
   * superseded.
   */
  abstract review(input: ReviewKycDocumentInput): Promise<KycDocument>;
}
