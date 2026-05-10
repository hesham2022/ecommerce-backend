import { ReturnReason, ReturnStatus } from './return-enums';
import { ReturnItem } from './return-item';
import { ReturnAttachment } from './return-attachment';

export class Return {
  id!: string;
  subOrderId!: string;
  buyerId!: number;
  vendorId!: string;
  status!: ReturnStatus;
  reason!: ReturnReason;
  reasonNote!: string | null;
  returnTrackingNumber!: string | null;
  totalRefundMinor!: string;
  restocked!: boolean | null;
  rejectReason!: string | null;
  createdAt!: Date;
  decidedAt!: Date | null;
  shippedBackAt!: Date | null;
  receivedAt!: Date | null;
  refundedAt!: Date | null;
  closedAt!: Date | null;
  rejectedAt!: Date | null;
  updatedAt!: Date;
  items!: ReturnItem[];
  attachments!: ReturnAttachment[];
}
