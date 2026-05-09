import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { ReviewEntity } from './review.entity';

@Entity({ name: 'vendor_response' })
@Unique('uq_vendor_response_review_id', ['reviewId'])
export class VendorResponseEntity extends EntityRelationalHelper {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'review_id', type: 'uuid' })
  reviewId!: string;

  @OneToOne(() => ReviewEntity, (r) => r.vendorResponse, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'review_id' })
  review!: ReviewEntity;

  @Column({ type: 'text' })
  body!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
