import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class MarkReadDto {
  @ApiPropertyOptional({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  @IsOptional()
  @IsUUID()
  messageId?: string;
}
