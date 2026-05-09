import { ApiProperty } from '@nestjs/swagger';
import { ConversationReportStatus } from './chat-enums';

export class ConversationReport {
  @ApiProperty({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  id!: string;

  @ApiProperty({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  conversationId!: string;

  @ApiProperty({ example: 42 })
  reporterUserId!: number;

  @ApiProperty({ example: 'Spam' })
  reason!: string;

  @ApiProperty({
    enum: ConversationReportStatus,
    example: ConversationReportStatus.OPEN,
  })
  status!: ConversationReportStatus;

  @ApiProperty()
  createdAt!: Date;
}
