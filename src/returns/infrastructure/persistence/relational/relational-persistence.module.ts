import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReturnAbstractRepository } from '../return.abstract.repository';
import { ReturnAttachmentEntity } from './entities/return-attachment.entity';
import { ReturnItemEntity } from './entities/return-item.entity';
import { ReturnRequestEntity } from './entities/return-request.entity';
import { ReturnRelationalRepository } from './repositories/return.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReturnRequestEntity,
      ReturnItemEntity,
      ReturnAttachmentEntity,
    ]),
  ],
  providers: [
    {
      provide: ReturnAbstractRepository,
      useClass: ReturnRelationalRepository,
    },
  ],
  exports: [ReturnAbstractRepository],
})
export class RelationalReturnPersistenceModule {}
