import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RegisterFcmTokenDto } from './dto/register-fcm-token.dto';
import { FcmTokenEntity } from './entities/fcm-token.entity';
import { FcmTokenService } from './fcm-token.service';

@ApiTags('FCM Tokens')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'me/fcm-tokens', version: '1' })
export class FcmTokenController {
  constructor(private readonly fcmTokens: FcmTokenService) {}

  @Post()
  @ApiCreatedResponse({ type: FcmTokenEntity })
  async register(
    @Req() req: Request,
    @Body() dto: RegisterFcmTokenDto,
  ): Promise<FcmTokenEntity> {
    const userId = (req.user as { id: number }).id;
    return this.fcmTokens.upsert({
      userId,
      token: dto.token,
      platform: dto.platform,
      deviceId: dto.deviceId,
    });
  }

  @Delete(':token')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Req() req: Request,
    @Param('token') token: string,
  ): Promise<void> {
    const userId = (req.user as { id: number }).id;
    await this.fcmTokens.deleteForUser(userId, token);
  }
}
