import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiProperty({
    minLength: 1,
    maxLength: 2000,
    example: 'Great quality, fast shipping.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'IDs of files (already uploaded via /api/v1/files) to attach as review media. Max 6.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsUUID('4', { each: true })
  mediaFileIds?: string[];
}
