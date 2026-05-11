import { KycDocument } from '../../../../domain/kyc-document';
import { KycDocumentEntity } from '../entities/kyc-document.entity';

export class KycDocumentMapper {
  static toDomain(entity: KycDocumentEntity): KycDocument {
    const dom = new KycDocument();
    dom.id = entity.id;
    dom.vendorId = entity.vendorId;
    dom.type = entity.type;
    dom.fileId = entity.fileId;
    dom.status = entity.status;
    dom.details = entity.details ?? {};
    dom.rejectReason = entity.rejectReason ?? null;
    dom.supersededAt = entity.supersededAt ?? null;
    dom.submittedAt = entity.submittedAt;
    dom.reviewedAt = entity.reviewedAt ?? null;
    dom.reviewedByUserId = entity.reviewedByUserId ?? null;
    dom.createdAt = entity.createdAt;
    dom.updatedAt = entity.updatedAt;
    return dom;
  }
}
