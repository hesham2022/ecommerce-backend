import { ApiProperty } from '@nestjs/swagger';
import { MessageAttachmentKind } from './chat-enums';

export class MessageAttachment {
  @ApiProperty({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  id!: string;

  @ApiProperty({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  messageId!: string;

  @ApiProperty({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  fileId!: string;

  @ApiProperty({
    enum: MessageAttachmentKind,
    example: MessageAttachmentKind.IMAGE,
  })
  kind!: MessageAttachmentKind;

  @ApiProperty({ example: 0 })
  position!: number;
}
