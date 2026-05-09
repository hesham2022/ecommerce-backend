import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../roles/roles.decorator';
import { RolesGuard } from '../roles/roles.guard';
import { RoleEnum } from '../roles/roles.enum';
import { AdminSearchService } from './admin-search.service';
import { AdminSearchQueryDto } from './dto/admin-search-query.dto';

@ApiTags('Admin · Search')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(RoleEnum.admin)
@Controller({ path: 'admin/search', version: '1' })
export class AdminSearchController {
  constructor(private readonly service: AdminSearchService) {}

  @Get()
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        vendors: { type: 'array' },
        products: { type: 'array' },
        orders: { type: 'array' },
        users: { type: 'array' },
      },
    },
  })
  search(@Query() q: AdminSearchQueryDto) {
    const limit = Math.min(q.limit ?? 10, 50);
    return this.service.search(q.q, q.type, limit);
  }
}
