import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { PaymentProviderName } from '../../../../domain/payment-enums';
import { PaymentEntity } from './payment.entity';

@Entity({ name: 'payment_event' })
@Unique('uq_payment_event_provider_evt', ['provider', 'providerEventId'])
@Index('idx_payment_event_payment', ['paymentId'])
export class PaymentEventEntity extends EntityRelationalHelper {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'payment_id', type: 'uuid' })
  paymentId!: string;

  @ManyToOne(() => PaymentEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'payment_id' })
  payment!: PaymentEntity;

  @Column({
    type: 'enum',
    enum: PaymentProviderName,
    enumName: 'payment_provider_enum',
  })
  provider!: PaymentProviderName;

  @Column({ name: 'provider_event_id', length: 255 })
  providerEventId!: string;

  @Column({ name: 'event_type', length: 128 })
  eventType!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt!: Date;
}
