import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderEntity } from '../orders/infrastructure/persistence/relational/entities/order.entity';
import { OrderItemEntity } from '../orders/infrastructure/persistence/relational/entities/order-item.entity';
import { SubOrderEntity } from '../orders/infrastructure/persistence/relational/entities/sub-order.entity';
import { ProductEntity } from '../products/infrastructure/persistence/relational/entities/product.entity';
import { FileEntity } from '../files/infrastructure/persistence/relational/entities/file.entity';
import { ProductsModule } from '../products/products.module';
import { ReviewsAdminController } from './reviews-admin.controller';
import { ReviewsBuyerController } from './reviews-buyer.controller';
import { ReviewsPublicController } from './reviews-public.controller';
import { ReviewsVendorController } from './reviews-vendor.controller';
import { ReviewsService } from './reviews.service';
import { RelationalReviewPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';

@Module({
  imports: [
    RelationalReviewPersistenceModule,
    TypeOrmModule.forFeature([
      OrderEntity,
      SubOrderEntity,
      OrderItemEntity,
      ProductEntity,
      FileEntity,
    ]),
    ProductsModule,
  ],
  controllers: [
    ReviewsPublicController,
    ReviewsBuyerController,
    ReviewsVendorController,
    ReviewsAdminController,
  ],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
