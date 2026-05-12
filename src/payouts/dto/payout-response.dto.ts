import { ApiProperty } from '@nestjs/swagger';
import { VendorPayoutStatus } from '../domain/payout-enums';

export class PayoutResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() vendorId!: string;
  @ApiProperty() cycleKey!: string;
  @ApiProperty() amountMinor!: string;
  @ApiProperty() currencyCode!: string;
  @ApiProperty({ enum: VendorPayoutStatus }) status!: VendorPayoutStatus;
  @ApiProperty() ibanLast4!: string;
  @ApiProperty() bankName!: string;
  @ApiProperty({ required: false, nullable: true }) issuedAt!: string | null;
  @ApiProperty({ required: false, nullable: true }) paidAt!: string | null;
  @ApiProperty({ required: false, nullable: true }) failedAt!: string | null;
  @ApiProperty({ required: false, nullable: true }) failureReason!:
    | string
    | null;
  @ApiProperty() createdAt!: string;
}
