import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { VendorLedgerRepository } from './infrastructure/persistence/vendor-ledger.abstract.repository';
import { VendorPayoutRepository } from './infrastructure/persistence/vendor-payout.abstract.repository';
import { PayoutBatchRepository } from './infrastructure/persistence/payout-batch.abstract.repository';
import { LedgerEntryType, VendorPayoutStatus } from './domain/payout-enums';
import { computeEarning, computeClawback } from './payout-math';
import { ReviewPayoutDto } from './dto/review-payout.dto';
import { computeBalance } from './ledger-balance';
import { formatISOWeek } from './cycle-key';

function computeNextMondayAt9(from: Date): Date {
  const d = new Date(from);
  d.setUTCHours(9, 0, 0, 0);
  const dayOfWeek = d.getUTCDay();
  let daysUntilMonday = (1 + 7 - dayOfWeek) % 7;
  if (daysUntilMonday === 0 && d.getTime() <= from.getTime())
    daysUntilMonday = 7;
  d.setUTCDate(d.getUTCDate() + daysUntilMonday);
  return d;
}

export interface OnReturnRefundedInput {
  returnId: string;
  vendorId: string;
  subOrderId: string;
  refundedSubtotalMinor: string;
  refundedShippingMinor: string;
  currencyCode: string;
}

export interface OnSubOrderDeliveredInput {
  subOrderId: string;
  vendorId: string;
  subtotalMinor: string;
  shippingMinor: string;
  currencyCode: string;
  deliveredAt: Date;
}

const ALLOWED: Record<VendorPayoutStatus, VendorPayoutStatus[]> = {
  [VendorPayoutStatus.PENDING]: [
    VendorPayoutStatus.ISSUED,
    VendorPayoutStatus.CANCELED,
  ],
  [VendorPayoutStatus.ISSUED]: [
    VendorPayoutStatus.PAID,
    VendorPayoutStatus.FAILED,
  ],
  [VendorPayoutStatus.PAID]: [],
  [VendorPayoutStatus.FAILED]: [],
  [VendorPayoutStatus.CANCELED]: [],
};

const ACTION_BY_STATUS: Record<VendorPayoutStatus, string> = {
  [VendorPayoutStatus.PENDING]: 'PAYOUT_CREATED',
  [VendorPayoutStatus.ISSUED]: 'PAYOUT_MARKED_ISSUED',
  [VendorPayoutStatus.PAID]: 'PAYOUT_MARKED_PAID',
  [VendorPayoutStatus.FAILED]: 'PAYOUT_MARKED_FAILED',
  [VendorPayoutStatus.CANCELED]: 'PAYOUT_CANCELED',
};

// Loose service contracts — concrete classes get wired in Task 18 via the payouts module.
interface VendorReader {
  findById(id: string): Promise<{
    id: string;
    status?: string;
    kycStatus?: string;
    commissionRate: string;
  } | null>;
  listEligibleForPayout(
    asOf: Date,
  ): Promise<
    Array<{ vendorId: string; availableMinor: string; currencyCode: string }>
  >;
}
interface SettingsReader {
  getValue<K extends string>(key: K): Promise<any>;
}
interface AuditWriter {
  record(input: {
    adminUserId: string | null;
    action: string;
    targetType: string;
    targetId: string;
    payload?: Record<string, unknown>;
  }): Promise<void>;
}
interface KycReader {
  findLatestApprovedIban(vendorId: string): Promise<{
    iban: string;
    bankName: string;
    accountHolderName?: string;
  } | null>;
}

@Injectable()
export class PayoutService {
  constructor(
    private readonly ledger: VendorLedgerRepository,
    private readonly payouts: VendorPayoutRepository,
    private readonly batches: PayoutBatchRepository,
    private readonly vendors: VendorReader,
    private readonly settings: SettingsReader,
    private readonly audit: AuditWriter,
    private readonly kyc: KycReader,
  ) {}

  async onSubOrderDelivered(input: OnSubOrderDeliveredInput): Promise<void> {
    const existing = await this.ledger.findEarningForSubOrder(input.subOrderId);
    if (existing) return;

    const vendor = await this.vendors.findById(input.vendorId);
    if (!vendor)
      throw new NotFoundException(`vendor ${input.vendorId} not found`);

    const holdDays = await this.settings.getValue('payout_hold_days');
    const availableAt = new Date(
      input.deliveredAt.getTime() + holdDays * 24 * 60 * 60 * 1000,
    );

    const earned = computeEarning({
      subtotalMinor: input.subtotalMinor,
      shippingMinor: input.shippingMinor,
      commissionRate: vendor.commissionRate,
    });

    await this.ledger.create({
      vendorId: input.vendorId,
      type: LedgerEntryType.EARNING,
      amountMinor: earned,
      currencyCode: input.currencyCode,
      availableAt,
      subOrderId: input.subOrderId,
      memo: `Earning from sub-order ${input.subOrderId}`,
    });
  }

  async issuePayoutsForCycle(cycleKey: string): Promise<{ batchId: string }> {
    const batch = await this.batches.createIfAbsent(cycleKey);
    if (!batch) {
      const existing = await this.batches.findByCycle(cycleKey);
      return { batchId: existing!.id };
    }

    const minimum = BigInt(
      await this.settings.getValue('payout_minimum_amount_minor'),
    );
    const now = new Date();
    const candidates = await this.vendors.listEligibleForPayout(now);

    let vendorCount = 0;
    let total = 0n;

    for (const c of candidates) {
      const available = BigInt(c.availableMinor);
      if (available < minimum) continue;

      const v = await this.vendors.findById(c.vendorId);
      if (!v || v.status !== 'ACTIVE' || v.kycStatus !== 'APPROVED') continue;

      const iban = await this.kyc.findLatestApprovedIban(c.vendorId);
      if (!iban) continue;

      const payout = await this.payouts.create({
        vendorId: c.vendorId,
        cycleKey,
        amountMinor: available.toString(),
        currencyCode: c.currencyCode,
        ibanSnapshot: iban.iban,
        bankNameSnapshot: iban.bankName,
        accountHolderSnapshot: iban.accountHolderName ?? null,
      });

      await this.ledger.create({
        vendorId: c.vendorId,
        type: LedgerEntryType.PAYOUT_ISSUED,
        amountMinor: `-${available.toString()}`,
        currencyCode: c.currencyCode,
        availableAt: now,
        payoutId: payout.id,
        memo: `Payout issued for cycle ${cycleKey}`,
      });

      vendorCount++;
      total += available;
    }

    await this.batches.markReady(batch.id, vendorCount, total.toString());
    return { batchId: batch.id };
  }

  async reviewPayout(
    id: string,
    dto: ReviewPayoutDto,
    adminUserId: string,
  ): Promise<void> {
    const current = await this.payouts.findById(id);
    if (!current) throw new NotFoundException(`payout ${id} not found`);

    if (!ALLOWED[current.status].includes(dto.status)) {
      throw new BadRequestException(
        `invalid transition from ${current.status} to ${dto.status}`,
      );
    }

    const now = new Date();
    const patch: Record<string, unknown> = { status: dto.status, adminUserId };
    if (dto.status === VendorPayoutStatus.ISSUED) patch.issuedAt = now;
    if (dto.status === VendorPayoutStatus.PAID) patch.paidAt = now;
    if (dto.status === VendorPayoutStatus.FAILED) {
      patch.failedAt = now;
      patch.failureReason = dto.failureReason!;
    }
    if (dto.status === VendorPayoutStatus.CANCELED) {
      patch.failureReason = dto.failureReason!;
    }

    await this.payouts.update(id, patch as any);

    if (
      dto.status === VendorPayoutStatus.FAILED ||
      dto.status === VendorPayoutStatus.CANCELED
    ) {
      await this.ledger.create({
        vendorId: current.vendorId,
        type: LedgerEntryType.PAYOUT_REVERSED,
        amountMinor: current.amountMinor,
        currencyCode: current.currencyCode,
        availableAt: now,
        payoutId: id,
        memo: `Reversal: ${dto.failureReason ?? ''}`,
      });
    }

    await this.audit.record({
      adminUserId,
      action: ACTION_BY_STATUS[dto.status],
      targetType: 'vendor_payout',
      targetId: id,
      payload: { failureReason: dto.failureReason, memo: dto.memo },
    });
  }

  async createAdjustment(input: {
    vendorId: string;
    amountMinor: string;
    memo: string;
    adminUserId: string;
  }): Promise<void> {
    if (input.amountMinor === '0')
      throw new BadRequestException('amountMinor must be nonzero');

    await this.ledger.create({
      vendorId: input.vendorId,
      type: LedgerEntryType.ADJUSTMENT,
      amountMinor: input.amountMinor,
      currencyCode: 'SAR',
      availableAt: new Date(),
      adminUserId: input.adminUserId,
      memo: input.memo,
    });

    await this.audit.record({
      adminUserId: input.adminUserId,
      action: 'LEDGER_ADJUSTMENT',
      targetType: 'vendor',
      targetId: input.vendorId,
      payload: { amountMinor: input.amountMinor, memo: input.memo },
    });
  }

  async onReturnRefunded(input: OnReturnRefundedInput): Promise<void> {
    const existing = await this.ledger.findClawbackForReturn(input.returnId);
    if (existing) return;

    const vendor = await this.vendors.findById(input.vendorId);
    if (!vendor)
      throw new NotFoundException(`vendor ${input.vendorId} not found`);

    const clawback = computeClawback({
      refundedSubtotalMinor: input.refundedSubtotalMinor,
      refundedShippingMinor: input.refundedShippingMinor,
      commissionRate: vendor.commissionRate,
    });

    await this.ledger.create({
      vendorId: input.vendorId,
      type: LedgerEntryType.REFUND_CLAWBACK,
      amountMinor: `-${clawback}`,
      currencyCode: input.currencyCode,
      availableAt: new Date(),
      returnId: input.returnId,
      subOrderId: input.subOrderId,
      memo: `Refund clawback for return ${input.returnId}`,
    });
  }

  async getBalanceForVendor(vendorId: string): Promise<{
    currencyCode: string;
    heldBalanceMinor: string;
    availableBalanceMinor: string;
    lifetimePaidMinor: string;
    negativeBalanceWarning: boolean;
    nextCycleAt: string;
    minimumPayoutMinor: string;
  }> {
    const entries = await this.ledger.findByVendor(vendorId);
    const balance = computeBalance(
      entries.map((e) => ({
        type: e.type,
        amountMinor: e.amountMinor,
        availableAt: e.availableAt,
      })),
      new Date(),
    );
    const minimum = await this.settings.getValue('payout_minimum_amount_minor');
    return {
      currencyCode: entries[0]?.currencyCode ?? 'SAR',
      heldBalanceMinor: balance.heldMinor,
      availableBalanceMinor: balance.availableMinor,
      lifetimePaidMinor: balance.lifetimePaidMinor,
      negativeBalanceWarning: BigInt(balance.availableMinor) < 0n,
      nextCycleAt: computeNextMondayAt9(new Date()).toISOString(),
      minimumPayoutMinor: minimum,
    };
  }

  async getUpcomingForVendor(vendorId: string): Promise<{
    cycleKey: string;
    scheduledFor: string;
    projectedAmountMinor: string;
    wouldBePaid: boolean;
    reason: string | null;
  }> {
    const vendor = await this.vendors.findById(vendorId);
    const entries = await this.ledger.findByVendor(vendorId);
    const balance = computeBalance(
      entries.map((e) => ({
        type: e.type,
        amountMinor: e.amountMinor,
        availableAt: e.availableAt,
      })),
      new Date(),
    );
    const minimum = BigInt(
      await this.settings.getValue('payout_minimum_amount_minor'),
    );
    const next = computeNextMondayAt9(new Date());
    const projected = balance.availableMinor;

    let reason: string | null = null;
    if (vendor?.status !== 'ACTIVE') reason = 'VENDOR_SUSPENDED';
    else if (vendor.kycStatus !== 'APPROVED') reason = 'KYC_NOT_APPROVED';
    else if (BigInt(projected) < minimum) reason = 'BELOW_MINIMUM';

    return {
      cycleKey: formatISOWeek(next),
      scheduledFor: next.toISOString(),
      projectedAmountMinor: projected,
      wouldBePaid: reason === null,
      reason,
    };
  }
}
