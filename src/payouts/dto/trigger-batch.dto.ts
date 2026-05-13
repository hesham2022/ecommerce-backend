import { IsOptional, IsString, Matches } from 'class-validator';

export class TriggerBatchDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-W\d{2}$/, { message: 'cycleKey must be like "2026-W19"' })
  cycleKey?: string;
}
