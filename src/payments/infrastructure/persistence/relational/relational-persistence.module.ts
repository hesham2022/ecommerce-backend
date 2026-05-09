import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentAbstractRepository } from '../payment.abstract.repository';
import { PaymentEventAbstractRepository } from '../payment-event.abstract.repository';
import { PaymentEntity } from './entities/payment.entity';
import { PaymentEventEntity } from './entities/payment-event.entity';
import { PaymentRelationalRepository } from './repositories/payment.repository';
import { PaymentEventRelationalRepository } from './repositories/payment-event.repository';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentEntity, PaymentEventEntity])],
  providers: [
    {
      provide: PaymentAbstractRepository,
      useClass: PaymentRelationalRepository,
    },
    {
      provide: PaymentEventAbstractRepository,
      useClass: PaymentEventRelationalRepository,
    },
  ],
  exports: [PaymentAbstractRepository, PaymentEventAbstractRepository],
})
export class RelationalPaymentPersistenceModule {}
