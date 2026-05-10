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
import { FileEntity } from '../../../../../files/infrastructure/persistence/relational/entities/file.entity';
import { ReturnRequestEntity } from './return-request.entity';

@Entity({ name: 'return_attachment' })
@Index('idx_return_attachment_request', ['returnRequestId'])
export class ReturnAttachmentEntity extends EntityRelationalHelper {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'return_request_id', type: 'uuid' })
  returnRequestId!: string;

  @ManyToOne(() => ReturnRequestEntity, (r) => r.attachments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'return_request_id' })
  returnRequest!: ReturnRequestEntity;

  @Column({ name: 'file_id', type: 'uuid' })
  fileId!: string;

  @ManyToOne(() => FileEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'file_id' })
  file!: FileEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
