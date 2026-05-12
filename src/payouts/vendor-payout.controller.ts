import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../roles/roles.guard';
import { Roles } from '../roles/roles.decorator';
import { RoleEnum } from '../roles/roles.enum';
import { PayoutService } from './payout.service';
import { VendorLedgerRepository } from './infrastructure/persistence/vendor-ledger.abstract.repository';
import { VendorPayoutRepository } from './infrastructure/persistence/vendor-payout.abstract.repository';
import { ListLedgerQueryDto, ListPayoutsQueryDto } from './dto/list-query.dto';

@ApiTags('vendor-payouts')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(RoleEnum.vendor)
@Controller({ path: 'vendor/payouts', version: '1' })
export class VendorPayoutController {
  constructor(
    private readonly service: PayoutService,
    private readonly ledger: VendorLedgerRepository,
    private readonly payouts: VendorPayoutRepository,
  ) {}

  @Get('balance')
  balance(@Req() req: any) {
    const vendorId = req.user.vendorId;
    return this.service.getBalanceForVendor(vendorId);
  }

  @Get('upcoming')
  upcoming(@Req() req: any) {
    const vendorId = req.user.vendorId;
    return this.service.getUpcomingForVendor(vendorId);
  }

  @Get()
  async list(@Req() req: any, @Query() query: ListPayoutsQueryDto) {
    const result = await this.payouts.list({
      vendorId: req.user.vendorId,
      status: query.status,
      cycleKey: query.cycleKey,
      page: query.page,
      limit: query.limit,
    });
    return {
      data: result.data.map((p) => ({
        id: p.id,
        cycleKey: p.cycleKey,
        amountMinor: p.amountMinor,
        currencyCode: p.currencyCode,
        status: p.status,
        ibanLast4: p.ibanSnapshot.slice(-4),
        bankName: p.bankNameSnapshot,
        issuedAt: p.issuedAt?.toISOString() ?? null,
        paidAt: p.paidAt?.toISOString() ?? null,
        failedAt: p.failedAt?.toISOString() ?? null,
        failureReason: p.failureReason,
        createdAt: p.createdAt.toISOString(),
      })),
      hasNextPage: result.hasNextPage,
    };
  }

  @Get('ledger')
  async ledgerList(@Req() req: any, @Query() query: ListLedgerQueryDto) {
    const result = await this.ledger.list({
      vendorId: req.user.vendorId,
      type: query.type,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page,
      limit: query.limit,
    });
    return { data: result.data, hasNextPage: result.hasNextPage };
  }

  @Get(':id')
  async detail(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const p = await this.payouts.findById(id);
    if (!p) throw new NotFoundException(`payout ${id} not found`);
    if (p.vendorId !== req.user.vendorId) throw new ForbiddenException();
    const entries = await this.ledger.findByPayout(id);
    return {
      payout: {
        id: p.id,
        cycleKey: p.cycleKey,
        amountMinor: p.amountMinor,
        status: p.status,
      },
      ledgerEntries: entries.map((e) => ({
        id: e.id,
        type: e.type,
        amountMinor: e.amountMinor,
        memo: e.memo,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }
}
