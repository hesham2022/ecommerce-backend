import { Message } from '../../../../domain/message';
import { MessageAttachment } from '../../../../domain/message-attachment';
import { MessageEntity } from '../entities/message.entity';
import { MessageAttachmentEntity } from '../entities/message-attachment.entity';

export class MessageAttachmentMapper {
  static toDomain(entity: MessageAttachmentEntity): MessageAttachment {
    const d = new MessageAttachment();
    d.id = entity.id;
    d.messageId = entity.messageId;
    d.fileId = entity.fileId;
    d.kind = entity.kind;
    d.position = entity.position;
    return d;
  }
}

export class MessageMapper {
  static toDomain(entity: MessageEntity): Message {
    const d = new Message();
    d.id = entity.id;
    d.conversationId = entity.conversationId;
    d.senderUserId = entity.senderUserId;
    d.body = entity.body;
    d.attachments = (entity.attachments ?? []).map(
      MessageAttachmentMapper.toDomain,
    );
    d.createdAt = entity.createdAt;
    return d;
  }
}
