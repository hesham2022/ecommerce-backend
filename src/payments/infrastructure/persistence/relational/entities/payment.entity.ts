import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { OrderEntity } from '../../../../../orders/infrastructure/persistence/relational/entities/order.entity';
import {
  PaymentProviderName,
  PaymentStatus,
} from '../../../../domain/payment-enums';

@Entity({ name: 'payment' })
@Unique('uq_payment_provider_intent', ['provider', 'providerIntentId'])
@Index('idx_payment_order', ['orderId'])
export class PaymentEntity extends EntityRelationalHelper {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @ManyToOne(() => OrderEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order!: OrderEntity;

  @Column({
    type: 'enum',
    enum: PaymentProviderName,
    enumName: 'payment_provider_enum',
  })
  provider!: PaymentProviderName;

  @Column({ name: 'provider_intent_id', length: 255 })
  providerIntentId!: string;

  @Column({
    name: 'client_secret',
    type: 'varchar',
    length: 512,
    nullable: true,
  })
  clientSecret!: string | null;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    enumName: 'payment_status_enum',
    default: PaymentStatus.REQUIRES_ACTION,
  })
  status!: PaymentStatus;

  @Column({ name: 'amount_minor', type: 'bigint' })
  amountMinor!: string;

  @Column({ name: 'currency_code', length: 3 })
  currencyCode!: string;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
