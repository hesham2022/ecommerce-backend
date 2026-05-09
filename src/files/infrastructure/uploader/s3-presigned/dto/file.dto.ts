import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

export const CHAT_ATTACHMENT_PURPOSE = 'chat-attachment';
export const CHAT_ATTACHMENT_MIME_WHITELIST = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export class FileUploadDto {
  @ApiProperty({ example: 'image.jpg' })
  @IsString()
  fileName: string;

  @ApiProperty({ example: 138723 })
  @IsNumber()
  fileSize: number;

  @ApiProperty({ example: 'image/jpeg', required: false })
  @IsOptional()
  @IsString()
  mimeType?: string;

  @ApiProperty({ example: CHAT_ATTACHMENT_PURPOSE, required: false })
  @IsOptional()
  @IsString()
  @IsIn([CHAT_ATTACHMENT_PURPOSE, 'general'])
  purpose?: string;
}
