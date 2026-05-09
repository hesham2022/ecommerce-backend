import {
  Body,
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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ChatService } from './chat.service';
import { Conversation } from './domain/conversation';
import { Message } from './domain/message';
import { ArchiveConversationDto } from './dto/archive.dto';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { ListConversationsQueryDto } from './dto/list-conversations-query.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';
import { MarkReadDto } from './dto/mark-read.dto';
import { ReportConversationDto } from './dto/report-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';

@ApiTags('Chat · Conversations')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'conversations', version: '1' })
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  @ApiOperation({
    summary:
      'List the caller’s conversations, cursor-paginated by last_message_at DESC.',
  })
  async list(@Req() req: Request, @Query() query: ListConversationsQueryDto) {
    const userId = (req.user as { id: number }).id;
    return this.chat.listConversations(userId, {
      cursor: query.cursor,
      limit: query.limit,
      archived: query.archived,
    });
  }

  @Post()
  @ApiOperation({
    summary:
      'Create or fetch the conversation matching the given (kind, vendorId | subOrderId). Idempotent.',
  })
  async create(
    @Req() req: Request,
    @Body() dto: CreateConversationDto,
  ): Promise<Conversation> {
    const userId = (req.user as { id: number }).id;
    return this.chat.createConversation(userId, {
      kind: dto.kind,
      vendorId: dto.vendorId,
      subOrderId: dto.subOrderId,
    });
  }

  @Get(':id/messages')
  @ApiOperation({
    summary:
      'Cursor-paginated messages, oldest-first inside a window (mobile UX).',
  })
  async listMessages(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListMessagesQueryDto,
  ): Promise<{ data: Message[]; nextCursor: string | null }> {
    const userId = (req.user as { id: number }).id;
    return this.chat.listMessages(userId, id, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Post(':id/messages')
  @Throttle({ default: { limit: 10, ttl: 10_000 } })
  @ApiOperation({
    summary:
      'Send a message. Rate-limited to 10/10s per user. Body or attachments required.',
  })
  async sendMessage(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ): Promise<Message> {
    const userId = (req.user as { id: number }).id;
    return this.chat.sendMessage(userId, id, {
      body: dto.body,
      attachmentFileIds: dto.attachmentFileIds,
    });
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark conversation read up to a given message.' })
  async markRead(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkReadDto,
  ): Promise<{ ok: true }> {
    const userId = (req.user as { id: number }).id;
    await this.chat.markRead(userId, id, dto.messageId);
    return { ok: true };
  }

  @Patch(':id/archive')
  @ApiOperation({ summary: 'Archive or un-archive a conversation.' })
  async archive(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ArchiveConversationDto,
  ): Promise<{ ok: true }> {
    const userId = (req.user as { id: number }).id;
    await this.chat.setArchived(userId, id, dto.archived);
    return { ok: true };
  }

  @Post(':id/report')
  @ApiOperation({
    summary:
      'Report a conversation for moderation. Duplicate OPEN reports rejected.',
  })
  async report(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportConversationDto,
  ) {
    const userId = (req.user as { id: number }).id;
    return this.chat.report(userId, id, dto.reason);
  }
}
