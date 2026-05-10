import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../roles/roles.decorator';
import { RoleEnum } from '../roles/roles.enum';
import { RolesGuard } from '../roles/roles.guard';
import { ReturnStatus } from './domain/return-enums';
import { ReturnResponseDto } from './dto/return-response.dto';
import { ReturnsService } from './returns.service';

@ApiTags('Admin · Returns')
@ApiBearerAuth('jwt')
@Roles(RoleEnum.admin)
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller({ path: 'admin/returns', version: '1' })
export class AdminReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Get()
  @ApiOkResponse({ type: ReturnResponseDto, isArray: true })
  async list(
    @Query('vendorId') vendorId?: string,
    @Query('buyerId') buyerId?: string,
    @Query('status') status?: ReturnStatus,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ): Promise<{ data: ReturnResponseDto[]; total: number }> {
    const result = await this.returns.listForAdmin({
      vendorId,
      buyerId: buyerId !== undefined ? Number(buyerId) : undefined,
      status,
      page: Math.max(1, Number(page) || 1),
      limit: Math.min(100, Math.max(1, Number(limit) || 20)),
    });
    return {
      data: result.data.map(ReturnResponseDto.from),
      total: result.total,
    };
  }

  @Get(':id')
  @ApiOkResponse({ type: ReturnResponseDto })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReturnResponseDto> {
    const r = await this.returns.getByIdForAdmin(id);
    return ReturnResponseDto.from(r);
  }
}
