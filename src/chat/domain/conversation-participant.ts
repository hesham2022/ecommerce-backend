import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConversationParticipant {
  @ApiProperty({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  id!: string;

  @ApiProperty({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  conversationId!: string;

  @ApiProperty({ example: 42 })
  userId!: number;

  @ApiPropertyOptional({ example: null, nullable: true })
  lastReadMessageId!: string | null;

  @ApiProperty({ example: false })
  isArchived!: boolean;

  @ApiProperty({ example: false })
  isBlocked!: boolean;

  @ApiProperty()
  createdAt!: Date;
}
