import { ApiProperty } from '@nestjs/swagger';
import { Return } from '../domain/return';
import { ReturnReason, ReturnStatus } from '../domain/return-enums';

export class ReturnItemResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderItemId!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() refundAmountMinor!: string;
}

export class ReturnAttachmentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() fileId!: string;
}

export class ReturnResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() subOrderId!: string;
  @ApiProperty() vendorId!: string;
  @ApiProperty({ enum: ReturnStatus }) status!: ReturnStatus;
  @ApiProperty({ enum: ReturnReason }) reason!: ReturnReason;
  @ApiProperty({ required: false, nullable: true }) reasonNote!: string | null;
  @ApiProperty({ required: false, nullable: true })
  returnTrackingNumber!: string | null;
  @ApiProperty() totalRefundMinor!: string;
  @ApiProperty({ required: false, nullable: true })
  restocked!: boolean | null;
  @ApiProperty({ required: false, nullable: true })
  rejectReason!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ required: false, nullable: true })
  decidedAt!: Date | null;
  @ApiProperty({ required: false, nullable: true })
  shippedBackAt!: Date | null;
  @ApiProperty({ required: false, nullable: true })
  receivedAt!: Date | null;
  @ApiProperty({ required: false, nullable: true })
  refundedAt!: Date | null;
  @ApiProperty({ required: false, nullable: true })
  closedAt!: Date | null;
  @ApiProperty({ required: false, nullable: true })
  rejectedAt!: Date | null;
  @ApiProperty({ type: [ReturnItemResponseDto] })
  items!: ReturnItemResponseDto[];
  @ApiProperty({ type: [ReturnAttachmentResponseDto] })
  attachments!: ReturnAttachmentResponseDto[];

  static from(r: Return): ReturnResponseDto {
    const dto = new ReturnResponseDto();
    dto.id = r.id;
    dto.subOrderId = r.subOrderId;
    dto.vendorId = r.vendorId;
    dto.status = r.status;
    dto.reason = r.reason;
    dto.reasonNote = r.reasonNote;
    dto.returnTrackingNumber = r.returnTrackingNumber;
    dto.totalRefundMinor = r.totalRefundMinor;
    dto.restocked = r.restocked;
    dto.rejectReason = r.rejectReason;
    dto.createdAt = r.createdAt;
    dto.decidedAt = r.decidedAt;
    dto.shippedBackAt = r.shippedBackAt;
    dto.receivedAt = r.receivedAt;
    dto.refundedAt = r.refundedAt;
    dto.closedAt = r.closedAt;
    dto.rejectedAt = r.rejectedAt;
    dto.items = r.items.map((i) => ({
      id: i.id,
      orderItemId: i.orderItemId,
      quantity: i.quantity,
      refundAmountMinor: i.refundAmountMinor,
    }));
    dto.attachments = r.attachments.map((a) => ({
      id: a.id,
      fileId: a.fileId,
    }));
    return dto;
  }
}
