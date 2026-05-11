import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsObject, IsUUID } from 'class-validator';
import { KycDocumentType } from '../domain/kyc-enums';

export class UploadKycDocumentDto {
  @ApiProperty({ enum: KycDocumentType })
  @IsEnum(KycDocumentType)
  type!: KycDocumentType;

  @ApiProperty()
  @IsUUID()
  fileId!: string;

  @ApiProperty({
    description:
      'Per-type structured fields. CR: { number, issueDate, expiryDate? }. ' +
      'TAX: { taxNumber, expiryDate? }. IBAN: { iban, bankName, accountHolderName? }. ' +
      'OWNER_ID: { nationalId, expiryDate? }.',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  details!: Record<string, unknown>;
}
