import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { VendorEntity } from '../../../../../vendors/infrastructure/persistence/relational/entities/vendor.entity';
import { SubOrderEntity } from '../../../../../orders/infrastructure/persistence/relational/entities/sub-order.entity';
import { ReturnReason, ReturnStatus } from '../../../../domain/return-enums';
import { ReturnItemEntity } from './return-item.entity';
import { ReturnAttachmentEntity } from './return-attachment.entity';

@Entity({ name: 'return_request' })
@Index('idx_return_request_buyer_created_at', ['buyerId', 'createdAt'])
@Index('idx_return_request_vendor_status', ['vendorId', 'status'])
@Index('idx_return_request_sub_order', ['subOrderId'])
export class ReturnRequestEntity extends EntityRelationalHelper {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'sub_order_id', type: 'uuid' })
  subOrderId!: string;

  @ManyToOne(() => SubOrderEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sub_order_id' })
  subOrder!: SubOrderEntity;

  @Column({ name: 'buyer_id', type: 'integer' })
  buyerId!: number;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'buyer_id' })
  buyer!: UserEntity;

  @Column({ name: 'vendor_id', type: 'uuid' })
  vendorId!: string;

  @ManyToOne(() => VendorEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'vendor_id' })
  vendor!: VendorEntity;

  @Column({
    type: 'enum',
    enum: ReturnStatus,
    enumName: 'return_status_enum',
    default: ReturnStatus.REQUESTED,
  })
  status!: ReturnStatus;

  @Column({
    type: 'enum',
    enum: ReturnReason,
    enumName: 'return_reason_enum',
  })
  reason!: ReturnReason;

  @Column({ name: 'reason_note', type: 'text', nullable: true })
  reasonNote!: string | null;

  @Column({
    name: 'return_tracking_number',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  returnTrackingNumber!: string | null;

  @Column({ name: 'total_refund_minor', type: 'bigint' })
  totalRefundMinor!: string;

  @Column({ type: 'boolean', nullable: true })
  restocked!: boolean | null;

  @Column({ name: 'reject_reason', type: 'text', nullable: true })
  rejectReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  @Column({ name: 'shipped_back_at', type: 'timestamptz', nullable: true })
  shippedBackAt!: Date | null;

  @Column({ name: 'received_at', type: 'timestamptz', nullable: true })
  receivedAt!: Date | null;

  @Column({ name: 'refunded_at', type: 'timestamptz', nullable: true })
  refundedAt!: Date | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ name: 'rejected_at', type: 'timestamptz', nullable: true })
  rejectedAt!: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => ReturnItemEntity, (i) => i.returnRequest, { cascade: true })
  items!: ReturnItemEntity[];

  @OneToMany(() => ReturnAttachmentEntity, (a) => a.returnRequest, {
    cascade: true,
  })
  attachments!: ReturnAttachmentEntity[];
}
