import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminAuditLogModule } from '../admin-audit-log/admin-audit-log.module';
import { FilesModule } from '../files/files.module';
import { FcmModule } from '../fcm/fcm.module';
import { SubOrderEntity } from '../orders/infrastructure/persistence/relational/entities/sub-order.entity';
import { OrderEntity } from '../orders/infrastructure/persistence/relational/entities/order.entity';
import { UsersModule } from '../users/users.module';
import { VendorsModule } from '../vendors/vendors.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ConversationReportAdminController } from './conversation-report-admin.controller';
import { UserBlockController } from './user-block.controller';
import { RelationalChatPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { PushMessageProcessor } from './push/push-message.processor';
import { ImageThumbProcessor } from './thumbnails/image-thumb.processor';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 10_000, limit: 10_000 }]),
    BullModule.registerQueue({ name: 'push-message' }, { name: 'image-thumb' }),
    TypeOrmModule.forFeature([SubOrderEntity, OrderEntity]),
    RelationalChatPersistenceModule,
    UsersModule,
    VendorsModule,
    FilesModule,
    FcmModule,
    AdminAuditLogModule,
  ],
  controllers: [
    ChatController,
    UserBlockController,
    ConversationReportAdminController,
  ],
  providers: [
    ChatService,
    PushMessageProcessor,
    ImageThumbProcessor,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
  exports: [ChatService],
})
export class ChatModule {}
