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

@Entity({ name: 'admin_audit_log' })
@Index('idx_admin_audit_log_created_at', ['createdAt'])
@Index('idx_admin_audit_log_admin_user_id', ['adminUserId'])
@Index('idx_admin_audit_log_action', ['action'])
@Index('idx_admin_audit_log_target_type', ['targetType'])
export class AdminAuditLogEntity extends EntityRelationalHelper {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'admin_user_id', type: 'integer' })
  adminUserId!: number;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'admin_user_id' })
  adminUser!: UserEntity;

  @Column({ type: 'text' })
  action!: string;

  @Column({ name: 'target_type', type: 'text' })
  targetType!: string;

  @Column({ name: 'target_id', type: 'text', nullable: true })
  targetId!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  payload!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
