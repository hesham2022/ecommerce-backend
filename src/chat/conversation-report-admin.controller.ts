import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminAuditLogService } from '../admin-audit-log/admin-audit-log.service';
import { Roles } from '../roles/roles.decorator';
import { RolesGuard } from '../roles/roles.guard';
import { RoleEnum } from '../roles/roles.enum';
import { ChatService } from './chat.service';
import { AdminListReportsQueryDto } from './dto/admin-list-reports-query.dto';
import { AdminUpdateReportDto } from './dto/admin-update-report.dto';

@ApiTags('Admin · Conversation Reports')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(RoleEnum.admin)
@Controller({ path: 'admin/conversation-reports', version: '1' })
export class ConversationReportAdminController {
  constructor(
    private readonly chat: ChatService,
    private readonly audit: AdminAuditLogService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all conversation reports for moderation.' })
  async list(@Query() query: AdminListReportsQueryDto) {
    return this.chat.listReports({
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a conversation report’s status.' })
  async update(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateReportDto,
  ) {
    const adminUserId = (req.user as { id: number }).id;
    const updated = await this.chat.updateReportStatus(id, dto.status);
    await this.audit.record({
      adminUserId,
      action: 'CONVERSATION_REPORT_UPDATE',
      targetType: 'conversation_report',
      targetId: id,
      payload: { status: dto.status },
    });
    return updated;
  }
}
