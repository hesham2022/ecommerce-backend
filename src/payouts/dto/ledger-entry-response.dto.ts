import { ApiProperty } from '@nestjs/swagger';
import { LedgerEntryType } from '../domain/payout-enums';

export class LedgerEntryResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: LedgerEntryType }) type!: LedgerEntryType;
  @ApiProperty() amountMinor!: string;
  @ApiProperty() currencyCode!: string;
  @ApiProperty() availableAt!: string;
  @ApiProperty({ required: false, nullable: true }) subOrderId!: string | null;
  @ApiProperty({ required: false, nullable: true }) returnId!: string | null;
  @ApiProperty({ required: false, nullable: true }) payoutId!: string | null;
  @ApiProperty({ required: false, nullable: true }) memo!: string | null;
  @ApiProperty() createdAt!: string;
}
