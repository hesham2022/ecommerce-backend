import { ApiProperty } from '@nestjs/swagger';
import { KycDocument } from '../domain/kyc-document';
import { KycDocumentStatus, KycDocumentType } from '../domain/kyc-enums';

export class KycDocumentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() vendorId!: string;
  @ApiProperty({ enum: KycDocumentType }) type!: KycDocumentType;
  @ApiProperty() fileId!: string;
  @ApiProperty({ enum: KycDocumentStatus }) status!: KycDocumentStatus;
  @ApiProperty() details!: Record<string, unknown>;
  @ApiProperty({ required: false, nullable: true })
  rejectReason!: string | null;
  @ApiProperty({ required: false, nullable: true })
  supersededAt!: Date | null;
  @ApiProperty() submittedAt!: Date;
  @ApiProperty({ required: false, nullable: true })
  reviewedAt!: Date | null;
  @ApiProperty({ required: false, nullable: true })
  reviewedByUserId!: number | null;

  static from(d: KycDocument): KycDocumentResponseDto {
    const dto = new KycDocumentResponseDto();
    dto.id = d.id;
    dto.vendorId = d.vendorId;
    dto.type = d.type;
    dto.fileId = d.fileId;
    dto.status = d.status;
    dto.details = d.details;
    dto.rejectReason = d.rejectReason;
    dto.supersededAt = d.supersededAt;
    dto.submittedAt = d.submittedAt;
    dto.reviewedAt = d.reviewedAt;
    dto.reviewedByUserId = d.reviewedByUserId;
    return dto;
  }
}
