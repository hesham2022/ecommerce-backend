import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminAuditLogModule } from '../admin-audit-log/admin-audit-log.module';
import { FilesModule } from '../files/files.module';
import { SubOrderEntity } from '../orders/infrastructure/persistence/relational/entities/sub-order.entity';
import { OrderEntity } from '../orders/infrastructure/persistence/relational/entities/order.entity';
import { UsersModule } from '../users/users.module';
import { VendorsModule } from '../vendors/vendors.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ConversationReportAdminController } from './conversation-report-admin.controller';
import { UserBlockController } from './user-block.controller';
import { RelationalChatPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 10_000, limit: 10_000 }]),
    TypeOrmModule.forFeature([SubOrderEntity, OrderEntity]),
    RelationalChatPersistenceModule,
    UsersModule,
    VendorsModule,
    FilesModule,
    AdminAuditLogModule,
  ],
  controllers: [
    ChatController,
    UserBlockController,
    ConversationReportAdminController,
  ],
  providers: [ChatService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
  exports: [ChatService],
})
export class ChatModule {}
