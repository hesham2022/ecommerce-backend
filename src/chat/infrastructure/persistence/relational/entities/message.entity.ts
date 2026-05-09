import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { ConversationEntity } from './conversation.entity';
import { MessageAttachmentEntity } from './message-attachment.entity';

@Entity({ name: 'message' })
@Index('idx_message_conversation_created_at', ['conversationId', 'createdAt'])
export class MessageEntity extends EntityRelationalHelper {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @ManyToOne(() => ConversationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: ConversationEntity;

  @Column({ name: 'sender_user_id', type: 'int' })
  senderUserId!: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sender_user_id' })
  sender!: UserEntity;

  @Column({ type: 'text' })
  body!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => MessageAttachmentEntity, (a) => a.message)
  attachments!: MessageAttachmentEntity[];
}
