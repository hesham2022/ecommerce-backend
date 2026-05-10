import { forwardRef, Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { PaymentsModule } from '../payments/payments.module';
import { ProductsModule } from '../products/products.module';
import { RelationalProductPersistenceModule } from '../products/infrastructure/persistence/relational/relational-persistence.module';
import { RegionsModule } from '../regions/regions.module';
import { ShippingZonesModule } from '../shipping-zones/shipping-zones.module';
import { VendorsModule } from '../vendors/vendors.module';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { FulfillmentService } from './fulfillment.service';
import { IdempotencyHelper } from './idempotency.helper';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { VendorOrdersController } from './vendor-orders.controller';
import { VendorSubOrdersController } from './vendor-suborders.controller';
import { RelationalOrderPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';

@Module({
  imports: [
    RelationalOrderPersistenceModule,
    RelationalProductPersistenceModule,
    CartModule,
    ShippingZonesModule,
    VendorsModule,
    ProductsModule,
    RegionsModule,
    forwardRef(() => PaymentsModule),
  ],
  controllers: [
    CheckoutController,
    OrdersController,
    VendorOrdersController,
    VendorSubOrdersController,
  ],
  providers: [
    CheckoutService,
    OrdersService,
    FulfillmentService,
    IdempotencyHelper,
  ],
  exports: [CheckoutService, OrdersService, FulfillmentService],
})
export class OrdersModule {}
