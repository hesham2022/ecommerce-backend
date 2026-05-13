import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { VendorPayoutStatus } from '../domain/payout-enums';

export class ReviewPayoutDto {
  @IsEnum(VendorPayoutStatus)
  status!: VendorPayoutStatus;

  @ValidateIf(
    (o) =>
      o.status === VendorPayoutStatus.FAILED ||
      o.status === VendorPayoutStatus.CANCELED,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  failureReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  memo?: string;
}
