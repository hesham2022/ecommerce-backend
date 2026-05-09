import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class ArchiveConversationDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  archived!: boolean;
}
