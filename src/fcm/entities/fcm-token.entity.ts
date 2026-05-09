import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { UserEntity } from '../../users/infrastructure/persistence/relational/entities/user.entity';
import { EntityRelationalHelper } from '../../utils/relational-entity-helper';

export enum FcmPlatform {
  IOS = 'ios',
  ANDROID = 'android',
}

@Entity({ name: 'fcm_token' })
@Index('uq_fcm_token_token', ['token'], { unique: true })
@Index('idx_fcm_token_user_id', ['userId'])
export class FcmTokenEntity extends EntityRelationalHelper {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({ type: 'text' })
  token!: string;

  @Column({
    type: 'enum',
    enum: FcmPlatform,
    enumName: 'fcm_token_platform_enum',
  })
  platform!: FcmPlatform;

  @Column({ name: 'device_id', type: 'text' })
  deviceId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;
}
