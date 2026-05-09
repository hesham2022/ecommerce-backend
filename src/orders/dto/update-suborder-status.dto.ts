import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SubOrderFulfillmentStatus } from '../domain/order-enums';

/**
 * Vendor-driven status changes only — DELIVERED is buyer-driven via a
 * separate confirm-delivery endpoint.
 */
export const VENDOR_PATCH_STATUSES = [
  SubOrderFulfillmentStatus.CONFIRMED,
  SubOrderFulfillmentStatus.PACKED,
  SubOrderFulfillmentStatus.SHIPPED,
  SubOrderFulfillmentStatus.CANCELLED,
] as const;

export type VendorPatchStatus = (typeof VENDOR_PATCH_STATUSES)[number];

export class UpdateSubOrderStatusDto {
  @ApiProperty({ enum: VENDOR_PATCH_STATUSES })
  @IsIn(VENDOR_PATCH_STATUSES as readonly SubOrderFulfillmentStatus[])
  status!: VendorPatchStatus;

  @ApiPropertyOptional({ example: 'TRK-123456' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  trackingNumber?: string;

  @ApiPropertyOptional({ example: 'Aramex' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  courierName?: string;

  @ApiPropertyOptional({ example: 'Out of stock' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cancellationReason?: string;
}
