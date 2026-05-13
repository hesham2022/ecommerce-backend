import { ApiProperty } from '@nestjs/swagger';
import { PayoutBatchStatus } from '../domain/payout-enums';

export class BatchResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() cycleKey!: string;
  @ApiProperty() vendorCount!: number;
  @ApiProperty() totalAmountMinor!: string;
  @ApiProperty({ enum: PayoutBatchStatus }) status!: PayoutBatchStatus;
  @ApiProperty() createdAt!: string;
}
