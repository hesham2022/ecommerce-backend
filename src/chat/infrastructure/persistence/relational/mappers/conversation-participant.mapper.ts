import { ConversationParticipant } from '../../../../domain/conversation-participant';
import { ConversationParticipantEntity } from '../entities/conversation-participant.entity';

export class ConversationParticipantMapper {
  static toDomain(
    entity: ConversationParticipantEntity,
  ): ConversationParticipant {
    const d = new ConversationParticipant();
    d.id = entity.id;
    d.conversationId = entity.conversationId;
    d.userId = entity.userId;
    d.lastReadMessageId = entity.lastReadMessageId ?? null;
    d.isArchived = entity.isArchived;
    d.isBlocked = entity.isBlocked;
    d.createdAt = entity.createdAt;
    return d;
  }
}
