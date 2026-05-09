import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { OrderItemEntity } from '../../../../../orders/infrastructure/persistence/relational/entities/order-item.entity';
import { ProductEntity } from '../../../../../products/infrastructure/persistence/relational/entities/product.entity';
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { VendorEntity } from '../../../../../vendors/infrastructure/persistence/relational/entities/vendor.entity';
import { ReviewStatus } from '../../../../domain/review-status';
import { ReviewMediaEntity } from './review-media.entity';
import { VendorResponseEntity } from './vendor-response.entity';

@Entity({ name: 'review' })
@Unique('uq_review_order_item_id', ['orderItemId'])
@Index('idx_review_product_status_created', [
  'productId',
  'status',
  'createdAt',
])
@Index('idx_review_vendor_status_created', ['vendorId', 'status', 'createdAt'])
@Index('idx_review_buyer_id', ['buyerId'])
export class ReviewEntity extends EntityRelationalHelper {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'order_item_id', type: 'uuid' })
  orderItemId!: string;

  @ManyToOne(() => OrderItemEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_item_id' })
  orderItem!: OrderItemEntity;

  @Column({ name: 'product_id', type: 'uuid' })
  productId!: string;

  @ManyToOne(() => ProductEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product!: ProductEntity;

  @Column({ name: 'vendor_id', type: 'uuid' })
  vendorId!: string;

  @ManyToOne(() => VendorEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'vendor_id' })
  vendor!: VendorEntity;

  @Column({ name: 'buyer_id', type: 'int' })
  buyerId!: number;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'buyer_id' })
  buyer!: UserEntity;

  @Column({ type: 'smallint' })
  rating!: number;

  @Column({ type: 'text' })
  body!: string;

  @Column({
    type: 'enum',
    enum: ReviewStatus,
    enumName: 'review_status_enum',
    default: ReviewStatus.PUBLISHED,
  })
  status!: ReviewStatus;

  @OneToMany(() => ReviewMediaEntity, (m) => m.review)
  media!: ReviewMediaEntity[];

  @OneToOne(() => VendorResponseEntity, (r) => r.review)
  vendorResponse!: VendorResponseEntity | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
