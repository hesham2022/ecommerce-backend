import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { uuidv7Generate } from '../utils/uuid';
import { FilesService } from '../files/files.service';
import { KycDocument } from './domain/kyc-document';
import {
  KycDocumentStatus,
  KycDocumentType,
  KycStatus,
} from './domain/kyc-enums';
import {
  KycDocumentAbstractRepository,
  ListForAdminOptions,
  ListResult,
} from './infrastructure/persistence/kyc-document.abstract.repository';
import {
  computeKycStatus,
  KYC_EXPIRY_WARNING_DAYS,
  KYC_REQUIRED_TYPES,
} from './kyc-rollup';

const REQUIRED_DETAILS_BY_TYPE: Record<KycDocumentType, string[]> = {
  [KycDocumentType.COMMERCIAL_REGISTRATION]: ['number', 'issueDate'],
  [KycDocumentType.TAX_CERTIFICATE]: ['taxNumber'],
  [KycDocumentType.IBAN_DOCUMENT]: ['iban', 'bankName'],
  [KycDocumentType.OWNER_ID]: ['nationalId'],
};

export interface UploadInput {
  vendorId: string;
  type: KycDocumentType;
  fileId: string;
  details: Record<string, unknown>;
}

export interface ReviewInput {
  documentId: string;
  vendorId: string;
  status: KycDocumentStatus;
  rejectReason?: string;
  reviewedByUserId: number;
}

export interface VendorKycStatusSummary {
  kycStatus: KycStatus;
  requiredTypes: KycDocumentType[];
  submittedTypes: KycDocumentType[];
  missingTypes: KycDocumentType[];
  rejectedTypes: KycDocumentType[];
  expiringSoon: Array<{
    type: KycDocumentType;
    expiryDate: string;
    daysUntilExpiry: number;
  }>;
  expired: Array<{
    type: KycDocumentType;
    expiryDate: string;
    daysUntilExpiry: number;
  }>;
}

@Injectable()
export class KycService {
  constructor(
    private readonly docs: KycDocumentAbstractRepository,
    private readonly files: FilesService,
  ) {}

  async upload(input: UploadInput): Promise<KycDocument> {
    // 1. Validate required details fields for the given type
    const required = REQUIRED_DETAILS_BY_TYPE[input.type];
    for (const key of required) {
      const v = (input.details as Record<string, unknown>)[key];
      if (v === undefined || v === null || v === '') {
        throw new UnprocessableEntityException(
          `Missing required field "${key}" for ${input.type}`,
        );
      }
    }

    // 2. Validate fileId exists
    const file = await this.files.findById(input.fileId);
    if (!file) {
      throw new UnprocessableEntityException(
        `fileId ${input.fileId} not found`,
      );
    }

    // 3. Load current docs for this vendor
    const current = await this.docs.findCurrentByVendor(input.vendorId);
    const existingSameType = current.get(input.type);
    if (
      existingSameType &&
      existingSameType.status === KycDocumentStatus.PENDING
    ) {
      throw new UnprocessableEntityException(
        `A ${input.type} document is already pending review`,
      );
    }

    // 4. Compute the new aggregate kycStatus that will result from this upload
    //    (the new doc itself is PENDING)
    const updated = new Map<KycDocumentType, KycDocumentStatus>();
    for (const [k, v] of current.entries()) updated.set(k, v.status);
    updated.set(input.type, KycDocumentStatus.PENDING);
    const newKycStatus = computeKycStatus(KYC_REQUIRED_TYPES, updated);

    // 5. Insert + supersede + update vendor.kyc_status atomically
    return this.docs.upload(
      {
        id: uuidv7Generate(),
        vendorId: input.vendorId,
        type: input.type,
        fileId: input.fileId,
        details: input.details,
      },
      newKycStatus,
    );
  }

  async listForVendor(
    vendorId: string,
    opts?: { type?: KycDocumentType; includeSuperseded?: boolean },
  ): Promise<KycDocument[]> {
    return this.docs.listForVendor({
      vendorId,
      type: opts?.type,
      includeSuperseded: opts?.includeSuperseded ?? false,
    });
  }

  /**
   * Thin delegator over the repository for admin-facing list endpoints.
   * Keeps controllers free of repo-injection and avoids reaching into
   * `this.docs` from outside the service.
   */
  async listForAdmin(opts: ListForAdminOptions): Promise<ListResult> {
    return this.docs.listForAdmin(opts);
  }

  /**
   * Thin delegator over the repository for fetching a single document.
   * Used by the admin review flow to load the doc before calling `review`,
   * so callers don't have to reach into `this.docs` directly.
   */
  async findById(id: string): Promise<KycDocument | null> {
    return this.docs.findById(id);
  }

  async getStatusSummary(vendorId: string): Promise<VendorKycStatusSummary> {
    const current = await this.docs.findCurrentByVendor(vendorId);
    const statusByType = new Map<KycDocumentType, KycDocumentStatus>();
    for (const [k, v] of current.entries()) statusByType.set(k, v.status);
    const kycStatus = computeKycStatus(KYC_REQUIRED_TYPES, statusByType);

    const submittedTypes: KycDocumentType[] = [];
    const missingTypes: KycDocumentType[] = [];
    const rejectedTypes: KycDocumentType[] = [];
    for (const t of KYC_REQUIRED_TYPES) {
      if (current.has(t)) {
        submittedTypes.push(t);
        const s = current.get(t)!.status;
        if (s === KycDocumentStatus.REJECTED) rejectedTypes.push(t);
      } else {
        missingTypes.push(t);
      }
    }

    const now = Date.now();
    const expiringSoon: VendorKycStatusSummary['expiringSoon'] = [];
    const expired: VendorKycStatusSummary['expired'] = [];
    for (const [t, d] of current.entries()) {
      if (d.status !== KycDocumentStatus.APPROVED) continue;
      const expiry = (d.details as Record<string, unknown>)['expiryDate'];
      if (typeof expiry !== 'string') continue;
      const expiryMs = Date.parse(expiry);
      if (Number.isNaN(expiryMs)) continue;
      const daysUntilExpiry = Math.floor(
        (expiryMs - now) / (1000 * 60 * 60 * 24),
      );
      if (daysUntilExpiry < 0) {
        expired.push({ type: t, expiryDate: expiry, daysUntilExpiry });
      } else if (daysUntilExpiry <= KYC_EXPIRY_WARNING_DAYS) {
        expiringSoon.push({ type: t, expiryDate: expiry, daysUntilExpiry });
      }
    }

    return {
      kycStatus,
      requiredTypes: [...KYC_REQUIRED_TYPES],
      submittedTypes,
      missingTypes,
      rejectedTypes,
      expiringSoon,
      expired,
    };
  }

  async review(input: ReviewInput): Promise<KycDocument> {
    if (
      input.status !== KycDocumentStatus.APPROVED &&
      input.status !== KycDocumentStatus.REJECTED
    ) {
      throw new UnprocessableEntityException(
        `Cannot review with status ${input.status}`,
      );
    }
    if (
      input.status === KycDocumentStatus.REJECTED &&
      !input.rejectReason?.trim()
    ) {
      throw new UnprocessableEntityException(
        'rejectReason is required when rejecting a document',
      );
    }

    // Compute the new aggregate kycStatus that will result from this transition.
    // We need to load the current docs *after* simulating the change.
    const doc = await this.docs.findById(input.documentId);
    if (!doc)
      throw new NotFoundException(`Document ${input.documentId} not found`);
    if (doc.vendorId !== input.vendorId) {
      throw new NotFoundException(`Document ${input.documentId} not found`);
    }

    const current = await this.docs.findCurrentByVendor(input.vendorId);
    const statusByType = new Map<KycDocumentType, KycDocumentStatus>();
    for (const [k, v] of current.entries()) statusByType.set(k, v.status);
    statusByType.set(doc.type, input.status); // simulate
    const newKycStatus = computeKycStatus(KYC_REQUIRED_TYPES, statusByType);

    return this.docs.review({
      id: input.documentId,
      vendorId: input.vendorId,
      status: input.status,
      rejectReason: input.rejectReason?.trim() ?? null,
      reviewedByUserId: input.reviewedByUserId,
      reviewedAt: new Date(),
      newVendorKycStatus: newKycStatus,
    });
  }
}
