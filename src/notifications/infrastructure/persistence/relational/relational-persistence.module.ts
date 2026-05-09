import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationAbstractRepository } from '../notification.abstract.repository';
import { NotificationEntity } from './entities/notification.entity';
import { NotificationRelationalRepository } from './repositories/notification.repository';

@Module({
  imports: [TypeOrmModule.forFeature([NotificationEntity])],
  providers: [
    {
      provide: NotificationAbstractRepository,
      useClass: NotificationRelationalRepository,
    },
  ],
  exports: [NotificationAbstractRepository],
})
export class RelationalNotificationPersistenceModule {}
