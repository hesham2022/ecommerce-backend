import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { NotificationsService } from './notifications.service';
import { NotificationListQueryDto } from './dto/notification-list-query.dto';

@ApiTags('Me · Notifications')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'me/notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @ApiOkResponse({
    description: 'Cursor-paginated inbox, newest first.',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array' },
        nextCursor: { type: 'string', nullable: true },
      },
    },
  })
  async list(@Req() req: Request, @Query() query: NotificationListQueryDto) {
    const userId = (req.user as { id: number }).id;
    return this.service.list({
      userId,
      cursor: query.cursor ?? null,
      limit: Math.min(query.limit ?? 20, 100),
      unreadOnly: query.unreadOnly ?? false,
    });
  }

  @Get('unread-count')
  @ApiOkResponse({
    schema: { type: 'object', properties: { count: { type: 'number' } } },
  })
  async unreadCount(@Req() req: Request) {
    const userId = (req.user as { id: number }).id;
    const count = await this.service.unreadCount(userId);
    return { count };
  }

  @Patch('read-all')
  @ApiOkResponse({
    schema: { type: 'object', properties: { updated: { type: 'number' } } },
  })
  async readAll(@Req() req: Request) {
    const userId = (req.user as { id: number }).id;
    return this.service.markAllRead(userId);
  }

  @Post(':id/read')
  @ApiOkResponse({ description: 'Marks one notification as read.' })
  async markRead(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const userId = (req.user as { id: number }).id;
    return this.service.markRead(id, userId);
  }
}
