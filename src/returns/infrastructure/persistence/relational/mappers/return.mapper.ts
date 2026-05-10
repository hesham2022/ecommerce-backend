import { Return } from '../../../../domain/return';
import { ReturnAttachment } from '../../../../domain/return-attachment';
import { ReturnItem } from '../../../../domain/return-item';
import { ReturnAttachmentEntity } from '../entities/return-attachment.entity';
import { ReturnItemEntity } from '../entities/return-item.entity';
import { ReturnRequestEntity } from '../entities/return-request.entity';

export class ReturnMapper {
  static toDomain(entity: ReturnRequestEntity): Return {
    const dom = new Return();
    dom.id = entity.id;
    dom.subOrderId = entity.subOrderId;
    dom.buyerId = entity.buyerId;
    dom.vendorId = entity.vendorId;
    dom.status = entity.status;
    dom.reason = entity.reason;
    dom.reasonNote = entity.reasonNote ?? null;
    dom.returnTrackingNumber = entity.returnTrackingNumber ?? null;
    dom.totalRefundMinor = entity.totalRefundMinor;
    dom.restocked = entity.restocked ?? null;
    dom.rejectReason = entity.rejectReason ?? null;
    dom.createdAt = entity.createdAt;
    dom.decidedAt = entity.decidedAt ?? null;
    dom.shippedBackAt = entity.shippedBackAt ?? null;
    dom.receivedAt = entity.receivedAt ?? null;
    dom.refundedAt = entity.refundedAt ?? null;
    dom.closedAt = entity.closedAt ?? null;
    dom.rejectedAt = entity.rejectedAt ?? null;
    dom.updatedAt = entity.updatedAt;
    dom.items = (entity.items ?? []).map(ReturnMapper.itemToDomain);
    dom.attachments = (entity.attachments ?? []).map(
      ReturnMapper.attachmentToDomain,
    );
    return dom;
  }

  static itemToDomain(entity: ReturnItemEntity): ReturnItem {
    const dom = new ReturnItem();
    dom.id = entity.id;
    dom.returnRequestId = entity.returnRequestId;
    dom.orderItemId = entity.orderItemId;
    dom.quantity = entity.quantity;
    dom.refundAmountMinor = entity.refundAmountMinor;
    dom.createdAt = entity.createdAt;
    return dom;
  }

  static attachmentToDomain(entity: ReturnAttachmentEntity): ReturnAttachment {
    const dom = new ReturnAttachment();
    dom.id = entity.id;
    dom.returnRequestId = entity.returnRequestId;
    dom.fileId = entity.fileId;
    dom.createdAt = entity.createdAt;
    return dom;
  }
}
