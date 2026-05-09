import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { FileEntity } from '../../../../../files/infrastructure/persistence/relational/entities/file.entity';
import { MessageAttachmentKind } from '../../../../domain/chat-enums';
import { MessageEntity } from './message.entity';

@Entity({ name: 'message_attachment' })
@Index('idx_message_attachment_message_position', ['messageId', 'position'])
export class MessageAttachmentEntity extends EntityRelationalHelper {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'message_id', type: 'uuid' })
  messageId!: string;

  @ManyToOne(() => MessageEntity, (m) => m.attachments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'message_id' })
  message!: MessageEntity;

  @Column({ name: 'file_id', type: 'uuid' })
  fileId!: string;

  @ManyToOne(() => FileEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'file_id' })
  file!: FileEntity;

  @Column({
    type: 'enum',
    enum: MessageAttachmentKind,
    enumName: 'message_attachment_kind_enum',
  })
  kind!: MessageAttachmentKind;

  @Column({ type: 'int' })
  position!: number;
}
