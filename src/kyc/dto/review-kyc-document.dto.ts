import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { KycDocumentStatus } from '../domain/kyc-enums';

export class ReviewKycDocumentDto {
  @ApiProperty({
    enum: [KycDocumentStatus.APPROVED, KycDocumentStatus.REJECTED],
  })
  @IsEnum(KycDocumentStatus)
  status!: KycDocumentStatus;

  @ApiPropertyOptional({ description: 'Required when status = REJECTED' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rejectReason?: string;
}
