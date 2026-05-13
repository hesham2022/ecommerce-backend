import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateAdjustmentDto {
  @IsString()
  @Matches(/^-?[1-9]\d*$/, {
    message: 'amountMinor must be a nonzero signed integer string',
  })
  amountMinor!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  memo!: string;
}
