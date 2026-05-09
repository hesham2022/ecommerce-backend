import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReviewAbstractRepository } from '../review.abstract.repository';
import { AdminAuditLogEntity } from './entities/admin-audit-log.entity';
import { ReviewEntity } from './entities/review.entity';
import { ReviewMediaEntity } from './entities/review-media.entity';
import { VendorResponseEntity } from './entities/vendor-response.entity';
import { ReviewRelationalRepository } from './repositories/review.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReviewEntity,
      ReviewMediaEntity,
      VendorResponseEntity,
      AdminAuditLogEntity,
    ]),
  ],
  providers: [
    {
      provide: ReviewAbstractRepository,
      useClass: ReviewRelationalRepository,
    },
  ],
  exports: [ReviewAbstractRepository, TypeOrmModule],
})
export class RelationalReviewPersistenceModule {}
