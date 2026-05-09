import { Conversation } from '../../../../domain/conversation';
import { ConversationEntity } from '../entities/conversation.entity';

export class ConversationMapper {
  static toDomain(entity: ConversationEntity): Conversation {
    const d = new Conversation();
    d.id = entity.id;
    d.kind = entity.kind;
    d.vendorId = entity.vendorId;
    d.buyerId = entity.buyerId;
    d.subOrderId = entity.subOrderId ?? null;
    d.createdAt = entity.createdAt;
    d.lastMessageAt = entity.lastMessageAt;
    return d;
  }
}
