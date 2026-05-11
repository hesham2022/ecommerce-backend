import { ApiProperty } from '@nestjs/swagger';
import { KycDocumentType, KycStatus } from '../domain/kyc-enums';

export class KycExpiryWarning {
  @ApiProperty({ enum: KycDocumentType }) type!: KycDocumentType;
  @ApiProperty() expiryDate!: string;
  @ApiProperty() daysUntilExpiry!: number;
}

export class KycStatusResponseDto {
  @ApiProperty({ enum: KycStatus }) kycStatus!: KycStatus;
  @ApiProperty({ type: [String], enum: KycDocumentType })
  requiredTypes!: KycDocumentType[];
  @ApiProperty({ type: [String], enum: KycDocumentType })
  submittedTypes!: KycDocumentType[];
  @ApiProperty({ type: [String], enum: KycDocumentType })
  missingTypes!: KycDocumentType[];
  @ApiProperty({ type: [String], enum: KycDocumentType })
  rejectedTypes!: KycDocumentType[];
  @ApiProperty({ type: [KycExpiryWarning] })
  expiringSoon!: KycExpiryWarning[];
  @ApiProperty({ type: [KycExpiryWarning] })
  expired!: KycExpiryWarning[];
}
