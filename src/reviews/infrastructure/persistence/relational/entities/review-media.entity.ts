import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { FileEntity } from '../../../../../files/infrastructure/persistence/relational/entities/file.entity';
import { ReviewEntity } from './review.entity';

@Entity({ name: 'review_media' })
@Index('idx_review_media_review_position', ['reviewId', 'position'])
export class ReviewMediaEntity extends EntityRelationalHelper {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'review_id', type: 'uuid' })
  reviewId!: string;

  @ManyToOne(() => ReviewEntity, (r) => r.media, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'review_id' })
  review!: ReviewEntity;

  @Column({ name: 'file_id', type: 'uuid' })
  fileId!: string;

  @ManyToOne(() => FileEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'file_id' })
  file!: FileEntity;

  @Column({ type: 'int' })
  position!: number;
}
