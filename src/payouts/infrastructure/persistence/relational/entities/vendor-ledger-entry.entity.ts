import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  JoinColumn,
} from 'typeorm';
import { VendorEntity } from '../../../../../vendors/infrastructure/persistence/relational/entities/vendor.entity';
import { LedgerEntryType } from '../../../../domain/payout-enums';
import { VendorPayoutEntity } from './vendor-payout.entity';

@Entity({ name: 'vendor_ledger_entry' })
@Index(['vendorId', 'availableAt'])
export class VendorLedgerEntryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'vendor_id', type: 'uuid' })
  vendorId!: string;

  @ManyToOne(() => VendorEntity)
  @JoinColumn({ name: 'vendor_id' })
  vendor?: VendorEntity;

  @Column({
    type: 'enum',
    enum: LedgerEntryType,
    enumName: 'vendor_ledger_entry_type_enum',
  })
  type!: LedgerEntryType;

  @Column({ name: 'amount_minor', type: 'bigint' })
  amountMinor!: string;

  @Column({ name: 'currency_code', type: 'char', length: 3 })
  currencyCode!: string;

  @Column({ name: 'available_at', type: 'timestamptz' })
  availableAt!: Date;

  @Column({ name: 'sub_order_id', type: 'uuid', nullable: true })
  subOrderId!: string | null;

  @Column({ name: 'return_id', type: 'uuid', nullable: true })
  returnId!: string | null;

  @Column({ name: 'payout_id', type: 'uuid', nullable: true })
  payoutId!: string | null;

  @ManyToOne(() => VendorPayoutEntity, { nullable: true })
  @JoinColumn({ name: 'payout_id' })
  payout?: VendorPayoutEntity | null;

  @Column({ name: 'admin_user_id', type: 'uuid', nullable: true })
  adminUserId!: string | null;

  @Column({ type: 'text', nullable: true })
  memo!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
