import { ApiProperty } from '@nestjs/swagger';
import { MessageAttachment } from './message-attachment';

export class Message {
  @ApiProperty({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  id!: string;

  @ApiProperty({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  conversationId!: string;

  @ApiProperty({ example: 42 })
  senderUserId!: number;

  @ApiProperty({ example: 'Hello there' })
  body!: string;

  @ApiProperty({ type: () => [MessageAttachment] })
  attachments!: MessageAttachment[];

  @ApiProperty()
  createdAt!: Date;
}
