import { Injectable } from '@nestjs/common';
import { VendorPayoutStatus } from './domain/payout-enums';

export interface PayoutCsvRow {
  id: string;
  vendorId: string;
  vendorName: string;
  cycleKey: string;
  amountMinor: string;
  currencyCode: string;
  status: VendorPayoutStatus;
  ibanSnapshot: string;
  bankNameSnapshot: string;
  accountHolderSnapshot: string | null;
}

const BOM = '﻿';
const HEADER =
  'payout_id,vendor_id,vendor_name,iban,bank_name,account_holder,amount,currency,reference,memo';

@Injectable()
export class PayoutCsvService {
  generate(cycleKey: string, rows: PayoutCsvRow[]): string {
    const body = rows
      .map((r, i) => this.formatRow(r, i + 1, cycleKey))
      .join('\n');
    return `${BOM}${HEADER}\n${body}\n`;
  }

  private formatRow(r: PayoutCsvRow, seq: number, cycleKey: string): string {
    const amount = this.minorToMajor(r.amountMinor);
    const reference = `PAYOUT-${cycleKey}-${String(seq).padStart(3, '0')}`;
    const memo = `Cycle ${cycleKey}`;
    return [
      this.quote(r.id),
      this.quote(r.vendorId),
      this.quote(r.vendorName),
      this.quote(r.ibanSnapshot),
      this.quote(r.bankNameSnapshot),
      this.quote(r.accountHolderSnapshot ?? ''),
      this.quote(amount),
      this.quote(r.currencyCode),
      this.quote(reference),
      this.quote(memo),
    ].join(',');
  }

  private minorToMajor(minor: string): string {
    const n = BigInt(minor);
    const sign = n < 0n ? '-' : '';
    const abs = n < 0n ? -n : n;
    const whole = abs / 100n;
    const cents = abs % 100n;
    return `${sign}${whole.toString()}.${cents.toString().padStart(2, '0')}`;
  }

  private quote(s: string): string {
    return `"${s.replace(/"/g, '""')}"`;
  }
}
