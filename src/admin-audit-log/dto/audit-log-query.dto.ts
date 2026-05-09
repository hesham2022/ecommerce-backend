import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class AuditLogQueryDto {
  @ApiPropertyOptional({ description: 'Filter by admin user id' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  adminUserId?: number;

  @ApiPropertyOptional({ description: 'Filter by action (exact match)' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  action?: string;

  @ApiPropertyOptional({ description: 'Filter by target_type' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  targetType?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }: { value: unknown }) => Number(value) || 20)
  limit?: number = 20;
}
