import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PayoutBatchStatus } from '../../../../domain/payout-enums';

@Entity({ name: 'payout_batch' })
@Index(['cycleKey'], { unique: true })
export class PayoutBatchEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'cycle_key', type: 'text' })
  cycleKey!: string;

  @Column({ name: 'vendor_count', type: 'int', default: 0 })
  vendorCount!: number;

  @Column({ name: 'total_amount_minor', type: 'bigint', default: '0' })
  totalAmountMinor!: string;

  @Column({
    type: 'enum',
    enum: PayoutBatchStatus,
    enumName: 'payout_batch_status_enum',
    default: PayoutBatchStatus.BUILDING,
  })
  status!: PayoutBatchStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
