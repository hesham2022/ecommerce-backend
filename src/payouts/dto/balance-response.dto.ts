import { ApiProperty } from '@nestjs/swagger';

export class BalanceResponseDto {
  @ApiProperty() currencyCode!: string;
  @ApiProperty() heldBalanceMinor!: string;
  @ApiProperty() availableBalanceMinor!: string;
  @ApiProperty() lifetimePaidMinor!: string;
  @ApiProperty() negativeBalanceWarning!: boolean;
  @ApiProperty() nextCycleAt!: string;
  @ApiProperty() minimumPayoutMinor!: string;
}
