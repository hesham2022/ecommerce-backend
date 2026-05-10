import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ConfirmShippedBackDto } from './dto/confirm-shipped-back.dto';
import { CreateReturnDto } from './dto/create-return.dto';
import { ReturnResponseDto } from './dto/return-response.dto';
import { ReturnStatus } from './domain/return-enums';
import { ReturnsService } from './returns.service';

@ApiTags('Buyer · Returns')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller({ version: '1' })
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Post('orders/:orderId/suborders/:subOrderId/returns')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: ReturnResponseDto })
  async create(
    @Req() req: Request,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('subOrderId', ParseUUIDPipe) subOrderId: string,
    @Body() dto: CreateReturnDto,
  ): Promise<ReturnResponseDto> {
    const buyerId = (req.user as { id: number }).id;
    const created = await this.returns.create({
      buyerId,
      orderId,
      subOrderId,
      items: dto.items,
      reason: dto.reason,
      reasonNote: dto.reasonNote,
      fileIds: dto.fileIds,
    });
    return ReturnResponseDto.from(created);
  }

  @Get('returns')
  @ApiOkResponse({ type: ReturnResponseDto, isArray: true })
  async listMine(
    @Req() req: Request,
    @Query('subOrderId') subOrderId?: string,
    @Query('status') status?: ReturnStatus,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ): Promise<{ data: ReturnResponseDto[]; total: number }> {
    const buyerId = (req.user as { id: number }).id;
    const result = await this.returns.listForBuyer({
      buyerId,
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

  @Get('returns/:id')
  @ApiOkResponse({ type: ReturnResponseDto })
  async getById(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReturnResponseDto> {
    const buyerId = (req.user as { id: number }).id;
    const r = await this.returns.getByIdForBuyer(buyerId, id);
    return ReturnResponseDto.from(r);
  }

  @Patch('returns/:id/shipped-back')
  @ApiOkResponse({ type: ReturnResponseDto })
  async confirmShippedBack(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmShippedBackDto,
  ): Promise<ReturnResponseDto> {
    const buyerId = (req.user as { id: number }).id;
    const r = await this.returns.confirmShippedBack({
      buyerId,
      returnId: id,
      trackingNumber: dto.trackingNumber,
    });
    return ReturnResponseDto.from(r);
  }
}
