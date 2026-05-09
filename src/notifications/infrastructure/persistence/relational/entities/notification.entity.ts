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

@Entity({ name: 'notification' })
@Index('idx_notification_user_created_at', ['userId', 'createdAt'])
@Index('idx_notification_user_unread', ['userId', 'isRead'])
export class NotificationEntity extends EntityRelationalHelper {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'integer' })
  userId!: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({ type: 'text' })
  type!: string;

  @Column({ name: 'title_translations', type: 'jsonb' })
  titleTranslations!: Record<string, string>;

  @Column({ name: 'body_translations', type: 'jsonb' })
  bodyTranslations!: Record<string, string>;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  data!: Record<string, unknown>;

  @Column({ name: 'is_read', type: 'boolean', default: false })
  isRead!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt!: Date | null;
}
