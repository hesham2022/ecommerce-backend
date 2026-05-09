import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ReportConversationDto {
  @ApiProperty({ example: 'User is sending spam' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
