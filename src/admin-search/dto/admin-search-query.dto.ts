import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export enum AdminSearchType {
  vendor = 'vendor',
  product = 'product',
  order = 'order',
  user = 'user',
}

export class AdminSearchQueryDto {
  @ApiPropertyOptional({
    description: 'Free-text query (ILIKE %q% on a curated set of columns)',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  q!: string;

  @ApiPropertyOptional({ enum: AdminSearchType })
  @IsOptional()
  @IsEnum(AdminSearchType)
  type?: AdminSearchType;

  @ApiPropertyOptional({ default: 10, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}
