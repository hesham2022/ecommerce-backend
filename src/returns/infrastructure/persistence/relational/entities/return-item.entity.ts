import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { OrderItemEntity } from '../../../../../orders/infrastructure/persistence/relational/entities/order-item.entity';
import { ReturnRequestEntity } from './return-request.entity';

@Entity({ name: 'return_item' })
@Index('idx_return_item_request', ['returnRequestId'])
@Index('idx_return_item_order_item', ['orderItemId'])
export class ReturnItemEntity extends EntityRelationalHelper {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'return_request_id', type: 'uuid' })
  returnRequestId!: string;

  @ManyToOne(() => ReturnRequestEntity, (r) => r.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'return_request_id' })
  returnRequest!: ReturnRequestEntity;

  @Column({ name: 'order_item_id', type: 'uuid' })
  orderItemId!: string;

  @ManyToOne(() => OrderItemEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'order_item_id' })
  orderItem!: OrderItemEntity;

  @Column({ type: 'integer' })
  quantity!: number;

  @Column({ name: 'refund_amount_minor', type: 'bigint' })
  refundAmountMinor!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
