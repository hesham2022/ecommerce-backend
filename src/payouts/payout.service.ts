import { Injectable, NotFoundException } from '@nestjs/common';
import { VendorLedgerRepository } from './infrastructure/persistence/vendor-ledger.abstract.repository';
import { VendorPayoutRepository } from './infrastructure/persistence/vendor-payout.abstract.repository';
import { PayoutBatchRepository } from './infrastructure/persistence/payout-batch.abstract.repository';
import { LedgerEntryType } from './domain/payout-enums';
import { computeEarning, computeClawback } from './payout-math';

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

// Loose service contracts — concrete classes get wired in Task 18 via the payouts module.
interface VendorReader {
  findById(id: string): Promise<{ id: string; commissionRate: string } | null>;
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
}
