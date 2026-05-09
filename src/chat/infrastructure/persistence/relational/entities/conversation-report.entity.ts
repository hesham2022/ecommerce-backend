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
import { ConversationReportStatus } from '../../../../domain/chat-enums';
import { ConversationEntity } from './conversation.entity';

@Entity({ name: 'conversation_report' })
@Index('idx_conversation_report_status_created_at', ['status', 'createdAt'])
export class ConversationReportEntity extends EntityRelationalHelper {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @ManyToOne(() => ConversationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: ConversationEntity;

  @Column({ name: 'reporter_user_id', type: 'int' })
  reporterUserId!: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reporter_user_id' })
  reporter!: UserEntity;

  @Column({ type: 'varchar', length: 500 })
  reason!: string;

  @Column({
    type: 'enum',
    enum: ConversationReportStatus,
    enumName: 'conversation_report_status_enum',
    default: ConversationReportStatus.OPEN,
  })
  status!: ConversationReportStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
