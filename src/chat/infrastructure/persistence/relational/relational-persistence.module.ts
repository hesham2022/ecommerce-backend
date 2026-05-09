import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatAbstractRepository } from '../chat.abstract.repository';
import { ConversationEntity } from './entities/conversation.entity';
import { ConversationParticipantEntity } from './entities/conversation-participant.entity';
import { ConversationReportEntity } from './entities/conversation-report.entity';
import { MessageAttachmentEntity } from './entities/message-attachment.entity';
import { MessageEntity } from './entities/message.entity';
import { UserBlockEntity } from './entities/user-block.entity';
import { ChatRelationalRepository } from './repositories/chat.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ConversationEntity,
      MessageEntity,
      MessageAttachmentEntity,
      ConversationParticipantEntity,
      UserBlockEntity,
      ConversationReportEntity,
    ]),
  ],
  providers: [
    {
      provide: ChatAbstractRepository,
      useClass: ChatRelationalRepository,
    },
  ],
  exports: [ChatAbstractRepository],
})
export class RelationalChatPersistenceModule {}
