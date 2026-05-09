import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, MinLength } from 'class-validator';
import { FcmPlatform } from '../entities/fcm-token.entity';

export class RegisterFcmTokenDto {
  @ApiProperty({ example: 'fcm-token' })
  @IsString()
  @MinLength(1)
  token!: string;

  @ApiProperty({ enum: FcmPlatform, example: FcmPlatform.IOS })
  @IsEnum(FcmPlatform)
  platform!: FcmPlatform;

  @ApiProperty({ example: 'device-123' })
  @IsString()
  @MinLength(1)
  deviceId!: string;
}
