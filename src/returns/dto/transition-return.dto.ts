import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ReturnStatus } from '../domain/return-enums';

export type VendorTargetStatus =
  | ReturnStatus.APPROVED
  | ReturnStatus.REJECTED
  | ReturnStatus.RECEIVED
  | ReturnStatus.REFUNDED
  | ReturnStatus.CLOSED;

export class TransitionReturnDto {
  @ApiProperty({
    enum: [
      ReturnStatus.APPROVED,
      ReturnStatus.REJECTED,
      ReturnStatus.RECEIVED,
      ReturnStatus.REFUNDED,
      ReturnStatus.CLOSED,
    ],
  })
  @IsEnum(ReturnStatus)
  status!: VendorTargetStatus;

  @ApiPropertyOptional({ description: 'Required when status = REJECTED' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rejectReason?: string;

  @ApiPropertyOptional({ description: 'Required when status = RECEIVED' })
  @IsOptional()
  @IsBoolean()
  restock?: boolean;
}
