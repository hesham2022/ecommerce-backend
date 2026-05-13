import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import {
  VendorPayoutStatus,
  PayoutBatchStatus,
  LedgerEntryType,
} from '../domain/payout-enums';

export class ListPayoutsQueryDto {
  @IsOptional() @IsString() vendorId?: string;
  @IsOptional() @IsEnum(VendorPayoutStatus) status?: VendorPayoutStatus;
  @IsOptional() @IsString() cycleKey?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit: number =
    20;
}

export class ListBatchesQueryDto {
  @IsOptional() @IsEnum(PayoutBatchStatus) status?: PayoutBatchStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit: number =
    20;
}

export class ListLedgerQueryDto {
  @IsOptional() @IsEnum(LedgerEntryType) type?: LedgerEntryType;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit: number =
    20;
}
