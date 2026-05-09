import {
  Controller,
  Delete,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ChatService } from './chat.service';

@ApiTags('Chat · User Block')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'users', version: '1' })
export class UserBlockController {
  constructor(private readonly chat: ChatService) {}

  @Post(':id/block')
  @ApiOperation({
    summary:
      'Block another user. Future DMs/messages from the blocked user are rejected.',
  })
  async block(
    @Req() req: Request,
    @Param('id', ParseIntPipe) targetUserId: number,
  ): Promise<{ ok: true }> {
    const userId = (req.user as { id: number }).id;
    await this.chat.block(userId, targetUserId);
    return { ok: true };
  }

  @Delete(':id/block')
  @ApiOperation({ summary: 'Unblock a previously-blocked user.' })
  async unblock(
    @Req() req: Request,
    @Param('id', ParseIntPipe) targetUserId: number,
  ): Promise<{ ok: true }> {
    const userId = (req.user as { id: number }).id;
    await this.chat.unblock(userId, targetUserId);
    return { ok: true };
  }
}
