import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { VendorPayoutStatus } from '../../../../domain/payout-enums';

@Entity({ name: 'vendor_payout' })
@Index(['vendorId', 'cycleKey'], { unique: true })
@Index(['status'])
@Index(['cycleKey'])
export class VendorPayoutEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'vendor_id', type: 'uuid' })
  vendorId!: string;

  @Column({ name: 'cycle_key', type: 'text' })
  cycleKey!: string;

  @Column({ name: 'amount_minor', type: 'bigint' })
  amountMinor!: string;

  @Column({ name: 'currency_code', type: 'char', length: 3 })
  currencyCode!: string;

  @Column({
    type: 'enum',
    enum: VendorPayoutStatus,
    enumName: 'vendor_payout_status_enum',
    default: VendorPayoutStatus.PENDING,
  })
  status!: VendorPayoutStatus;

  @Column({ name: 'iban_snapshot', type: 'text' })
  ibanSnapshot!: string;

  @Column({ name: 'bank_name_snapshot', type: 'text' })
  bankNameSnapshot!: string;

  @Column({ name: 'account_holder_snapshot', type: 'text', nullable: true })
  accountHolderSnapshot!: string | null;

  @Column({ name: 'issued_at', type: 'timestamptz', nullable: true })
  issuedAt!: Date | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt!: Date | null;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason!: string | null;

  @Column({ name: 'admin_user_id', type: 'uuid', nullable: true })
  adminUserId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
