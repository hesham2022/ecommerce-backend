import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { RelationalOrderPersistenceModule } from '../orders/infrastructure/persistence/relational/relational-persistence.module';
import { FilesModule } from '../files/files.module';
import { VendorsModule } from '../vendors/vendors.module';
import { ProductsModule } from '../products/products.module';
import { AdminReturnsController } from './admin-returns.controller';
import { RelationalReturnPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';
import { VendorReturnsController } from './vendor-returns.controller';

@Module({
  imports: [
    RelationalReturnPersistenceModule,
    RelationalOrderPersistenceModule,
    OrdersModule,
    FilesModule,
    VendorsModule,
    ProductsModule,
  ],
  controllers: [
    ReturnsController,
    VendorReturnsController,
    AdminReturnsController,
  ],
  providers: [ReturnsService],
  exports: [ReturnsService],
})
export class ReturnsModule {}
