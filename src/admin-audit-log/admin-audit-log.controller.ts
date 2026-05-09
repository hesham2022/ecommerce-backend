import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../roles/roles.decorator';
import { RolesGuard } from '../roles/roles.guard';
import { RoleEnum } from '../roles/roles.enum';
import { AdminAuditLogService } from './admin-audit-log.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

@ApiTags('Admin · Audit Log')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(RoleEnum.admin)
@Controller({ path: 'admin/audit-log', version: '1' })
export class AdminAuditLogController {
  constructor(private readonly service: AdminAuditLogService) {}

  @Get()
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array' },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' },
      },
    },
  })
  async list(@Query() q: AuditLogQueryDto) {
    const page = q.page ?? 1;
    const limit = Math.min(q.limit ?? 20, 100);
    const { data, total } = await this.service.list({
      adminUserId: q.adminUserId,
      action: q.action,
      targetType: q.targetType,
      page,
      limit,
    });
    return { data, total, page, limit };
  }
}
