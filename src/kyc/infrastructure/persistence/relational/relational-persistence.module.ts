import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KycDocumentAbstractRepository } from '../kyc-document.abstract.repository';
import { KycDocumentEntity } from './entities/kyc-document.entity';
import { KycDocumentRelationalRepository } from './repositories/kyc-document.repository';

@Module({
  imports: [TypeOrmModule.forFeature([KycDocumentEntity])],
  providers: [
    {
      provide: KycDocumentAbstractRepository,
      useClass: KycDocumentRelationalRepository,
    },
  ],
  exports: [KycDocumentAbstractRepository],
})
export class RelationalKycPersistenceModule {}
