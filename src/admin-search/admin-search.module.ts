import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminSearchController } from './admin-search.controller';
import { AdminSearchService } from './admin-search.service';
import { VendorEntity } from '../vendors/infrastructure/persistence/relational/entities/vendor.entity';
import { ProductEntity } from '../products/infrastructure/persistence/relational/entities/product.entity';
import { OrderEntity } from '../orders/infrastructure/persistence/relational/entities/order.entity';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      VendorEntity,
      ProductEntity,
      OrderEntity,
      UserEntity,
    ]),
  ],
  controllers: [AdminSearchController],
  providers: [AdminSearchService],
})
export class AdminSearchModule {}
