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
@Index('idx_admin_audit_log_admin_created_at', ['adminUserId', 'createdAt'])
@Index('idx_admin_audit_log_target', ['targetType', 'targetId'])
export class AdminAuditLogEntity extends EntityRelationalHelper {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'admin_user_id', type: 'int' })
  adminUserId!: number;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'admin_user_id' })
  admin!: UserEntity;

  @Column({ type: 'varchar', length: 64 })
  action!: string;

  @Column({ name: 'target_type', type: 'varchar', length: 64 })
  targetType!: string;

  @Column({ name: 'target_id', type: 'varchar', length: 64 })
  targetId!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
