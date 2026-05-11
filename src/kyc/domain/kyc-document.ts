import { KycDocumentStatus, KycDocumentType } from './kyc-enums';

export class KycDocument {
  id!: string;
  vendorId!: string;
  type!: KycDocumentType;
  fileId!: string;
  status!: KycDocumentStatus;
  details!: Record<string, unknown>;
  rejectReason!: string | null;
  supersededAt!: Date | null;
  submittedAt!: Date;
  reviewedAt!: Date | null;
  reviewedByUserId!: number | null;
  createdAt!: Date;
  updatedAt!: Date;
}
