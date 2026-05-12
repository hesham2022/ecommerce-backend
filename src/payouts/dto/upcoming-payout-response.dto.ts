import { ApiProperty } from '@nestjs/swagger';

export class UpcomingPayoutResponseDto {
  @ApiProperty() cycleKey!: string;
  @ApiProperty() scheduledFor!: string;
  @ApiProperty() projectedAmountMinor!: string;
  @ApiProperty() wouldBePaid!: boolean;
  @ApiProperty({ required: false, nullable: true }) reason!: string | null;
}
