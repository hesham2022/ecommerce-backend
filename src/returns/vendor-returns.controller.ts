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
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ProductsService } from '../products/products.service';
import { ReturnStatus } from './domain/return-enums';
import { ReturnResponseDto } from './dto/return-response.dto';
import { TransitionReturnDto } from './dto/transition-return.dto';
import { ReturnsService } from './returns.service';

@ApiTags('Vendor · Returns')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'vendor/returns', version: '1' })
export class VendorReturnsController {
  constructor(
    private readonly returns: ReturnsService,
    private readonly products: ProductsService,
  ) {}

  @Get()
  @ApiOkResponse({ type: ReturnResponseDto, isArray: true })
  async list(
    @Req() req: Request,
    @Query('subOrderId') subOrderId?: string,
    @Query('status') status?: ReturnStatus,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ): Promise<{ data: ReturnResponseDto[]; total: number }> {
    const userId = (req.user as { id: number }).id;
    const vendor = await this.products.getCallingActiveVendor(userId);
    const result = await this.returns.listForVendor({
      vendorId: vendor.id,
      subOrderId,
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
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReturnResponseDto> {
    const userId = (req.user as { id: number }).id;
    const vendor = await this.products.getCallingActiveVendor(userId);
    const r = await this.returns.getByIdForVendor(vendor.id, id);
    return ReturnResponseDto.from(r);
  }

  @Patch(':id')
  @ApiOkResponse({ type: ReturnResponseDto })
  async transition(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionReturnDto,
  ): Promise<ReturnResponseDto> {
    const userId = (req.user as { id: number }).id;
    const vendor = await this.products.getCallingActiveVendor(userId);
    const r = await this.returns.vendorTransition({
      vendorId: vendor.id,
      returnId: id,
      targetStatus: dto.status,
      rejectReason: dto.rejectReason,
      restock: dto.restock,
    });
    return ReturnResponseDto.from(r);
  }
}
