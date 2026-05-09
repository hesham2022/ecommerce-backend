import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import {
  ConversationKind,
  ConversationReportStatus,
} from '../../../../domain/chat-enums';
import { Conversation } from '../../../../domain/conversation';
import { ConversationParticipant } from '../../../../domain/conversation-participant';
import { ConversationReport } from '../../../../domain/conversation-report';
import { Message } from '../../../../domain/message';
import { UserBlock } from '../../../../domain/user-block';
import {
  ChatAbstractRepository,
  ConversationListItem,
  CreateConversationInput,
  CreateMessageInput,
  ListConversationsForUserOptions,
  ListMessagesOptions,
} from '../../chat.abstract.repository';
import { ConversationEntity } from '../entities/conversation.entity';
import { ConversationParticipantEntity } from '../entities/conversation-participant.entity';
import { ConversationReportEntity } from '../entities/conversation-report.entity';
import { MessageAttachmentEntity } from '../entities/message-attachment.entity';
import { MessageEntity } from '../entities/message.entity';
import { UserBlockEntity } from '../entities/user-block.entity';
import { ConversationMapper } from '../mappers/conversation.mapper';
import { ConversationParticipantMapper } from '../mappers/conversation-participant.mapper';
import { ConversationReportMapper } from '../mappers/conversation-report.mapper';
import { MessageMapper } from '../mappers/message.mapper';

@Injectable()
export class ChatRelationalRepository implements ChatAbstractRepository {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(ConversationEntity)
    private readonly convoRepo: Repository<ConversationEntity>,
    @InjectRepository(MessageEntity)
    private readonly msgRepo: Repository<MessageEntity>,
    @InjectRepository(MessageAttachmentEntity)
    private readonly attachmentRepo: Repository<MessageAttachmentEntity>,
    @InjectRepository(ConversationParticipantEntity)
    private readonly participantRepo: Repository<ConversationParticipantEntity>,
    @InjectRepository(UserBlockEntity)
    private readonly blockRepo: Repository<UserBlockEntity>,
    @InjectRepository(ConversationReportEntity)
    private readonly reportRepo: Repository<ConversationReportEntity>,
  ) {}

  // ── Conversations ─────────────────────────────────────────────────

  async findConversationById(id: string): Promise<Conversation | null> {
    const row = await this.convoRepo.findOne({ where: { id } });
    return row ? ConversationMapper.toDomain(row) : null;
  }

  async findDirectByPair(
    vendorId: string,
    buyerId: number,
  ): Promise<Conversation | null> {
    const row = await this.convoRepo.findOne({
      where: {
        kind: ConversationKind.DIRECT,
        vendorId,
        buyerId,
        subOrderId: IsNull(),
      },
    });
    return row ? ConversationMapper.toDomain(row) : null;
  }

  async findOrderConversation(
    subOrderId: string,
  ): Promise<Conversation | null> {
    const row = await this.convoRepo.findOne({
      where: { kind: ConversationKind.ORDER, subOrderId },
    });
    return row ? ConversationMapper.toDomain(row) : null;
  }

  async createConversation(
    input: CreateConversationInput,
  ): Promise<Conversation> {
    return this.dataSource.transaction(async (em) => {
      const convoRepo = em.getRepository(ConversationEntity);
      const partRepo = em.getRepository(ConversationParticipantEntity);
      const created = convoRepo.create({
        id: input.conversation.id,
        kind: input.conversation.kind,
        vendorId: input.conversation.vendorId,
        buyerId: input.conversation.buyerId,
        subOrderId: input.conversation.subOrderId,
        lastMessageAt: new Date(),
      });
      await convoRepo.save(created);
      if (input.participants.length > 0) {
        const partEntities = input.participants.map((p) =>
          partRepo.create({
            id: p.id,
            conversationId: p.conversationId,
            userId: p.userId,
          }),
        );
        await partRepo.save(partEntities);
      }
      return ConversationMapper.toDomain(created);
    });
  }

  async listConversationsForUser(
    opts: ListConversationsForUserOptions,
  ): Promise<ConversationListItem[]> {
    // Find participant rows for this user, joined with the conversation.
    const qb = this.participantRepo
      .createQueryBuilder('p')
      .innerJoinAndSelect('p.conversation', 'c')
      .where('p.user_id = :userId', { userId: opts.userId })
      .andWhere('p.is_archived = :archived', { archived: opts.archived })
      .orderBy('c.last_message_at', 'DESC')
      .take(opts.limit);
    if (opts.cursor) {
      qb.andWhere('c.last_message_at < :cursor', { cursor: opts.cursor });
    }
    const partRows = await qb.getMany();
    if (partRows.length === 0) return [];

    const convoIds = partRows.map((r) => r.conversationId);

    // For each conversation, load:
    //  - the latest message (with attachments)
    //  - the counterparty participant
    //  - unread count (messages with id > last_read AND conversation_id = ...).
    const latestMessages = await this.msgRepo
      .createQueryBuilder('m')
      .where(
        `m.id IN (
          SELECT id FROM (
            SELECT m2.id, ROW_NUMBER() OVER (PARTITION BY m2.conversation_id ORDER BY m2.created_at DESC) AS rn
            FROM message m2
            WHERE m2.conversation_id IN (:...ids)
          ) ranked WHERE ranked.rn = 1
        )`,
        { ids: convoIds },
      )
      .leftJoinAndSelect('m.attachments', 'a')
      .getMany();
    const lastByConvo = new Map<string, MessageEntity>();
    for (const m of latestMessages) lastByConvo.set(m.conversationId, m);

    const otherParticipants = await this.participantRepo
      .createQueryBuilder('p')
      .where('p.conversation_id IN (:...ids)', { ids: convoIds })
      .andWhere('p.user_id != :userId', { userId: opts.userId })
      .getMany();
    const otherByConvo = new Map<string, ConversationParticipantEntity>();
    for (const p of otherParticipants) otherByConvo.set(p.conversationId, p);

    // Unread count per conversation: messages strictly newer than the
    // last_read_message_id (creation time), authored by anyone other than caller.
    const unreadResults: { conversationId: string; cnt: string }[] = [];
    for (const part of partRows) {
      const baseQb = this.msgRepo
        .createQueryBuilder('m')
        .where('m.conversation_id = :cid', { cid: part.conversationId })
        .andWhere('m.sender_user_id != :userId', { userId: opts.userId });
      if (part.lastReadMessageId) {
        baseQb.andWhere(
          'm.created_at > (SELECT created_at FROM message WHERE id = :lrm)',
          { lrm: part.lastReadMessageId },
        );
      }
      const cnt = await baseQb.getCount();
      unreadResults.push({
        conversationId: part.conversationId,
        cnt: String(cnt),
      });
    }
    const unreadByConvo = new Map<string, number>(
      unreadResults.map((r) => [r.conversationId, Number(r.cnt)]),
    );

    return partRows.map((p) => {
      const last = lastByConvo.get(p.conversationId) ?? null;
      const other = otherByConvo.get(p.conversationId) ?? null;
      return {
        conversation: ConversationMapper.toDomain(p.conversation),
        counterpartyUserId: other?.userId ?? 0,
        counterpartyVendorId:
          p.conversation.kind === ConversationKind.DIRECT ||
          p.conversation.kind === ConversationKind.ORDER
            ? p.conversation.vendorId
            : null,
        isArchived: p.isArchived,
        lastReadMessageId: p.lastReadMessageId ?? null,
        lastMessage: last ? MessageMapper.toDomain(last) : null,
        unreadCount: unreadByConvo.get(p.conversationId) ?? 0,
      } as ConversationListItem;
    });
  }

  async updateLastMessageAt(conversationId: string, when: Date): Promise<void> {
    await this.convoRepo.update(
      { id: conversationId },
      { lastMessageAt: when },
    );
  }

  // ── Participants ──────────────────────────────────────────────────

  async listParticipants(
    conversationId: string,
  ): Promise<ConversationParticipant[]> {
    const rows = await this.participantRepo.find({
      where: { conversationId },
    });
    return rows.map(ConversationParticipantMapper.toDomain);
  }

  async findParticipant(
    conversationId: string,
    userId: number,
  ): Promise<ConversationParticipant | null> {
    const row = await this.participantRepo.findOne({
      where: { conversationId, userId },
    });
    return row ? ConversationParticipantMapper.toDomain(row) : null;
  }

  async setLastReadMessage(
    conversationId: string,
    userId: number,
    messageId: string | null,
  ): Promise<void> {
    await this.participantRepo.update(
      { conversationId, userId },
      { lastReadMessageId: messageId },
    );
  }

  async setArchived(
    conversationId: string,
    userId: number,
    archived: boolean,
  ): Promise<void> {
    await this.participantRepo.update(
      { conversationId, userId },
      { isArchived: archived },
    );
  }

  // ── Messages ──────────────────────────────────────────────────────

  async createMessage(input: CreateMessageInput): Promise<Message> {
    return this.dataSource.transaction(async (em) => {
      const msgRepo = em.getRepository(MessageEntity);
      const attRepo = em.getRepository(MessageAttachmentEntity);
      const convoRepo = em.getRepository(ConversationEntity);
      const created = msgRepo.create({
        id: input.id,
        conversationId: input.conversationId,
        senderUserId: input.senderUserId,
        body: input.body,
      });
      await msgRepo.save(created);

      if (input.attachments.length > 0) {
        const attEntities = input.attachments.map((a) =>
          attRepo.create({
            id: a.id,
            messageId: input.id,
            fileId: a.fileId,
            kind: a.kind as never,
            position: a.position,
          }),
        );
        await attRepo.save(attEntities);
        // Re-load attachments for the response.
        const reloaded = await attRepo.find({
          where: { messageId: input.id },
          order: { position: 'ASC' },
        });
        created.attachments = reloaded;
      } else {
        created.attachments = [];
      }

      await convoRepo.update(
        { id: input.conversationId },
        { lastMessageAt: created.createdAt ?? new Date() },
      );

      return MessageMapper.toDomain(created);
    });
  }

  async findMessageById(id: string): Promise<Message | null> {
    const row = await this.msgRepo.findOne({
      where: { id },
      relations: ['attachments'],
    });
    return row ? MessageMapper.toDomain(row) : null;
  }

  async listMessages(opts: ListMessagesOptions): Promise<Message[]> {
    const qb = this.msgRepo
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.attachments', 'a')
      .where('m.conversation_id = :cid', { cid: opts.conversationId })
      .orderBy('m.created_at', 'DESC')
      .take(opts.limit);
    if (opts.cursor) {
      qb.andWhere('m.created_at < :cursor', { cursor: opts.cursor });
    }
    const rows = await qb.getMany();
    // Mobile expects oldest-first inside a window — reverse.
    rows.reverse();
    return rows.map(MessageMapper.toDomain);
  }

  async latestMessageId(conversationId: string): Promise<string | null> {
    const row = await this.msgRepo.findOne({
      where: { conversationId },
      order: { createdAt: 'DESC' },
    });
    return row?.id ?? null;
  }

  // ── User block ────────────────────────────────────────────────────

  async findBlock(
    blockerUserId: number,
    blockedUserId: number,
  ): Promise<UserBlock | null> {
    const row = await this.blockRepo.findOne({
      where: { blockerUserId, blockedUserId },
    });
    if (!row) return null;
    return {
      id: row.id,
      blockerUserId: row.blockerUserId,
      blockedUserId: row.blockedUserId,
      createdAt: row.createdAt,
    };
  }

  async isEitherBlocked(userA: number, userB: number): Promise<boolean> {
    const cnt = await this.blockRepo
      .createQueryBuilder('b')
      .where(
        '(b.blocker_user_id = :a AND b.blocked_user_id = :b) OR (b.blocker_user_id = :b AND b.blocked_user_id = :a)',
        { a: userA, b: userB },
      )
      .getCount();
    return cnt > 0;
  }

  async createBlock(
    id: string,
    blockerUserId: number,
    blockedUserId: number,
  ): Promise<UserBlock> {
    const row = this.blockRepo.create({
      id,
      blockerUserId,
      blockedUserId,
    });
    await this.blockRepo.save(row);
    return {
      id: row.id,
      blockerUserId: row.blockerUserId,
      blockedUserId: row.blockedUserId,
      createdAt: row.createdAt,
    };
  }

  async removeBlock(
    blockerUserId: number,
    blockedUserId: number,
  ): Promise<boolean> {
    const res = await this.blockRepo.delete({
      blockerUserId,
      blockedUserId,
    });
    return (res.affected ?? 0) > 0;
  }

  // ── Reports ───────────────────────────────────────────────────────

  async findOpenReportBy(
    conversationId: string,
    reporterUserId: number,
  ): Promise<ConversationReport | null> {
    const row = await this.reportRepo.findOne({
      where: {
        conversationId,
        reporterUserId,
        status: ConversationReportStatus.OPEN,
      },
    });
    return row ? ConversationReportMapper.toDomain(row) : null;
  }

  async createReport(
    id: string,
    conversationId: string,
    reporterUserId: number,
    reason: string,
  ): Promise<ConversationReport> {
    const row = this.reportRepo.create({
      id,
      conversationId,
      reporterUserId,
      reason,
      status: ConversationReportStatus.OPEN,
    });
    await this.reportRepo.save(row);
    return ConversationReportMapper.toDomain(row);
  }

  async findReportById(id: string): Promise<ConversationReport | null> {
    const row = await this.reportRepo.findOne({ where: { id } });
    return row ? ConversationReportMapper.toDomain(row) : null;
  }

  async listReports(opts: {
    status?: string;
    page: number;
    limit: number;
  }): Promise<{ data: ConversationReport[]; total: number }> {
    const qb = this.reportRepo
      .createQueryBuilder('r')
      .orderBy('r.created_at', 'DESC');
    if (opts.status) {
      qb.where('r.status = :status', { status: opts.status });
    }
    const offset = (opts.page - 1) * opts.limit;
    const [rows, total] = await qb
      .skip(offset)
      .take(opts.limit)
      .getManyAndCount();
    return {
      data: rows.map(ConversationReportMapper.toDomain),
      total,
    };
  }

  async updateReportStatus(
    id: string,
    status: string,
  ): Promise<ConversationReport> {
    await this.reportRepo.update({ id }, { status: status as never });
    const row = await this.reportRepo.findOneOrFail({ where: { id } });
    return ConversationReportMapper.toDomain(row);
  }
}
