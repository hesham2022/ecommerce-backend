import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ConversationKind } from '../domain/chat-enums';

export class CreateConversationDto {
  @ApiProperty({ enum: ConversationKind, example: ConversationKind.DIRECT })
  @IsEnum(ConversationKind)
  kind!: ConversationKind;

  @ApiPropertyOptional({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @ApiPropertyOptional({ example: '0190a4d5-3d23-7c2a-bb50-9c0f3a59c1a0' })
  @IsOptional()
  @IsUUID()
  subOrderId?: string;
}
