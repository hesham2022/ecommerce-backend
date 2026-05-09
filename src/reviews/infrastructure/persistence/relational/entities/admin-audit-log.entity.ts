import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

/**
 * Minimal append-only audit log for admin actions. Lives under the reviews
 * module for now because Phase 6 is the first feature that needs it; it
 * can move to a dedicated module when more admin surfaces show up.
 */
@Entity({ name: 'admin_audit_log' })
@Index('idx_admin_audit_target', ['targetType', 'targetId'])
@Index('idx_admin_audit_created_at', ['createdAt'])
export class AdminAuditLogEntity extends EntityRelationalHelper {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'admin_user_id', type: 'int' })
  adminUserId!: number;

  @Column({ length: 64 })
  action!: string;

  @Column({ name: 'target_type', length: 64 })
  targetType!: string;

  @Column({ name: 'target_id', type: 'varchar', length: 64 })
  targetId!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
