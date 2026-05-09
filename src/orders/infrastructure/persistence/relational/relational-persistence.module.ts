import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CartItemEntity } from '../../../../cart/infrastructure/persistence/relational/entities/cart-item.entity';
import { OrderAbstractRepository } from '../order.abstract.repository';
import { OrderEventAbstractRepository } from '../order-event.abstract.repository';
import { OrderEntity } from './entities/order.entity';
import { OrderEventEntity } from './entities/order-event.entity';
import { OrderItemEntity } from './entities/order-item.entity';
import { SubOrderEntity } from './entities/sub-order.entity';
import { OrderRelationalRepository } from './repositories/order.repository';
import { OrderEventRelationalRepository } from './repositories/order-event.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrderEntity,
      SubOrderEntity,
      OrderItemEntity,
      OrderEventEntity,
      CartItemEntity,
    ]),
  ],
  providers: [
    {
      provide: OrderAbstractRepository,
      useClass: OrderRelationalRepository,
    },
    {
      provide: OrderEventAbstractRepository,
      useClass: OrderEventRelationalRepository,
    },
  ],
  exports: [OrderAbstractRepository, OrderEventAbstractRepository],
})
export class RelationalOrderPersistenceModule {}
