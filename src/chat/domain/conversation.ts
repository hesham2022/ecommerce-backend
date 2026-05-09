import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConversationKind } from './chat-enums';

export class Conversation {
  @ApiProperty({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  id!: string;

  @ApiProperty({ enum: ConversationKind, example: ConversationKind.DIRECT })
  kind!: ConversationKind;

  @ApiProperty({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  vendorId!: string;

  @ApiProperty({ example: 42 })
  buyerId!: number;

  @ApiPropertyOptional({ example: null, nullable: true })
  subOrderId!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  lastMessageAt!: Date;
}
