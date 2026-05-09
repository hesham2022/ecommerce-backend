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
import { OrderEventType } from '../../../../domain/order-enums';
import { SubOrderEntity } from './sub-order.entity';

@Entity({ name: 'order_event' })
@Index('idx_order_event_sub_order_created_at', ['subOrderId', 'createdAt'])
export class OrderEventEntity extends EntityRelationalHelper {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'sub_order_id', type: 'uuid' })
  subOrderId!: string;

  @ManyToOne(() => SubOrderEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sub_order_id' })
  subOrder!: SubOrderEntity;

  @Column({
    name: 'event_type',
    type: 'enum',
    enum: OrderEventType,
    enumName: 'order_event_type_enum',
  })
  eventType!: OrderEventType;

  @Column({ name: 'from_status', type: 'text', nullable: true })
  fromStatus!: string | null;

  @Column({ name: 'to_status', type: 'text', nullable: true })
  toStatus!: string | null;

  @Column({ name: 'actor_user_id', type: 'int', nullable: true })
  actorUserId!: number | null;

  @Column({ name: 'payload', type: 'jsonb', nullable: true })
  payload!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
