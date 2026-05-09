import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ConversationReportStatus } from '../domain/chat-enums';

export class AdminUpdateReportDto {
  @ApiProperty({
    enum: ConversationReportStatus,
    example: ConversationReportStatus.RESOLVED,
  })
  @IsEnum(ConversationReportStatus)
  status!: ConversationReportStatus;
}
