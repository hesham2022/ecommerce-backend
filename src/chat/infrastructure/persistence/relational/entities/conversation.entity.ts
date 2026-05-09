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
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { VendorEntity } from '../../../../../vendors/infrastructure/persistence/relational/entities/vendor.entity';
import { SubOrderEntity } from '../../../../../orders/infrastructure/persistence/relational/entities/sub-order.entity';
import { ConversationKind } from '../../../../domain/chat-enums';

@Entity({ name: 'conversation' })
@Index('idx_conversation_buyer', ['buyerId'])
@Index('idx_conversation_vendor', ['vendorId'])
@Index('idx_conversation_last_message_at', ['lastMessageAt'])
export class ConversationEntity extends EntityRelationalHelper {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({
    type: 'enum',
    enum: ConversationKind,
    enumName: 'conversation_kind_enum',
  })
  kind!: ConversationKind;

  @Column({ name: 'vendor_id', type: 'uuid' })
  vendorId!: string;

  @ManyToOne(() => VendorEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'vendor_id' })
  vendor!: VendorEntity;

  @Column({ name: 'buyer_id', type: 'int' })
  buyerId!: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'buyer_id' })
  buyer!: UserEntity;

  @Column({ name: 'suborder_id', type: 'uuid', nullable: true })
  subOrderId!: string | null;

  @ManyToOne(() => SubOrderEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'suborder_id' })
  subOrder!: SubOrderEntity | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({
    name: 'last_message_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  lastMessageAt!: Date;
}
