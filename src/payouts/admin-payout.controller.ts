import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { RolesGuard } from '../roles/roles.guard';
import { Roles } from '../roles/roles.decorator';
import { RoleEnum } from '../roles/roles.enum';
import { PayoutService } from './payout.service';
import { PayoutCsvService } from './payout-csv.service';
import { VendorLedgerRepository } from './infrastructure/persistence/vendor-ledger.abstract.repository';
import { VendorPayoutRepository } from './infrastructure/persistence/vendor-payout.abstract.repository';
import { PayoutBatchRepository } from './infrastructure/persistence/payout-batch.abstract.repository';
import { ReviewPayoutDto } from './dto/review-payout.dto';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';
import { UpdateCommissionDto } from './dto/update-commission.dto';
import { TriggerBatchDto } from './dto/trigger-batch.dto';
import {
  ListBatchesQueryDto,
  ListLedgerQueryDto,
  ListPayoutsQueryDto,
} from './dto/list-query.dto';
import { formatISOWeek } from './cycle-key';
import { VendorsService } from '../vendors/vendors.service';

@ApiTags('admin-payouts')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(RoleEnum.admin)
@Controller({ path: 'admin', version: '1' })
export class AdminPayoutController {
  constructor(
    private readonly service: PayoutService,
    private readonly csv: PayoutCsvService,
    private readonly ledger: VendorLedgerRepository,
    private readonly payouts: VendorPayoutRepository,
    private readonly batches: PayoutBatchRepository,
    private readonly vendors: VendorsService,
  ) {}

  // Batches
  @Get('payouts/batches')
  listBatches(@Query() query: ListBatchesQueryDto) {
    return this.batches.list({
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('payouts/batches/:id')
  async getBatch(@Param('id', ParseUUIDPipe) id: string) {
    const b = await this.batches.findById(id);
    if (!b) throw new NotFoundException(`batch ${id} not found`);
    return b;
  }

  @Get('payouts/batches/:id/csv')
  async getBatchCsv(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const batch = await this.batches.findById(id);
    if (!batch) throw new NotFoundException(`batch ${id} not found`);
    const ps = await this.payouts.list({
      cycleKey: batch.cycleKey,
      page: 1,
      limit: 1000,
    });
    const vendorIds = Array.from(new Set(ps.data.map((p) => p.vendorId)));
    const vendorsById: Record<string, { name: string }> = {};
    for (const vid of vendorIds) {
      const v = await this.vendors.findById(vid);
      vendorsById[vid] = {
        name: v?.nameTranslations?.['en'] ?? '(unknown)',
      };
    }
    const rows = ps.data.map((p) => ({
      id: p.id,
      vendorId: p.vendorId,
      vendorName: vendorsById[p.vendorId]?.name ?? '(unknown)',
      cycleKey: p.cycleKey,
      amountMinor: p.amountMinor,
      currencyCode: p.currencyCode,
      status: p.status,
      ibanSnapshot: p.ibanSnapshot,
      bankNameSnapshot: p.bankNameSnapshot,
      accountHolderSnapshot: p.accountHolderSnapshot,
    }));
    const body = this.csv.generate(batch.cycleKey, rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="payouts-${batch.cycleKey}-${id.slice(0, 8)}.csv"`,
    );
    res.send(body);
  }

  @Post('payouts/batches')
  @HttpCode(HttpStatus.OK)
  async triggerBatch(@Body() dto: TriggerBatchDto) {
    const cycleKey = dto.cycleKey ?? formatISOWeek(new Date());
    const { batchId } = await this.service.issuePayoutsForCycle(cycleKey);
    return { batchId, cycleKey };
  }

  // Payouts queue
  @Get('payouts')
  listPayouts(@Query() query: ListPayoutsQueryDto) {
    return this.payouts.list({
      vendorId: query.vendorId,
      status: query.status,
      cycleKey: query.cycleKey,
      page: query.page,
      limit: query.limit,
    });
  }

  @Patch('payouts/:id')
  async review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewPayoutDto,
    @Req() req: any,
  ) {
    await this.service.reviewPayout(id, dto, req.user.id);
    return { ok: true };
  }

  // Vendor-scoped admin
  @Get('vendors/:vendorId/ledger')
  vendorLedger(
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
    @Query() query: ListLedgerQueryDto,
  ) {
    return this.ledger.list({
      vendorId,
      type: query.type,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page,
      limit: query.limit,
    });
  }

  @Post('vendors/:vendorId/ledger/adjustments')
  async adjust(
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
    @Body() dto: CreateAdjustmentDto,
    @Req() req: any,
  ) {
    await this.service.createAdjustment({
      vendorId,
      amountMinor: dto.amountMinor,
      memo: dto.memo,
      adminUserId: req.user.id,
    });
    return { ok: true };
  }

  @Patch('vendors/:vendorId/commission')
  async updateCommission(
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
    @Body() dto: UpdateCommissionDto,
    @Req() req: any,
  ) {
    await this.vendors.updateCommissionRate(
      vendorId,
      dto.commissionRate,
      req.user.id,
    );
    return { ok: true };
  }
}
