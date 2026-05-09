import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { uuidv7Generate } from '../utils/uuid';
import { UsersService } from '../users/users.service';
import { VendorsService } from '../vendors/vendors.service';
import { RoleEnum } from '../roles/roles.enum';
import { FilesService } from '../files/files.service';
import { FileType } from '../files/domain/file';
import {
  CHAT_ATTACHMENT_MIME_WHITELIST,
  CHAT_ATTACHMENT_PURPOSE,
} from '../files/infrastructure/uploader/s3-presigned/dto/file.dto';
import { RedisService } from '../redis/redis.service';
import { OrderEntity } from '../orders/infrastructure/persistence/relational/entities/order.entity';
import { SubOrderEntity } from '../orders/infrastructure/persistence/relational/entities/sub-order.entity';
import { VendorEntity } from '../vendors/infrastructure/persistence/relational/entities/vendor.entity';
import {
  ConversationKind,
  ConversationReportStatus,
  MessageAttachmentKind,
} from './domain/chat-enums';
import { Conversation } from './domain/conversation';
import { ConversationReport } from './domain/conversation-report';
import { Message } from './domain/message';
import {
  ChatAbstractRepository,
  ConversationListItem,
} from './infrastructure/persistence/chat.abstract.repository';
import { ChatPushJob } from './push/chat-push.payload';

const MAX_BODY_LEN = 5000;
const MAX_ATTACHMENTS = 5;
const DIRECT_UNREPLIED_LIMIT = 30;
const DIRECT_UNREPLIED_WINDOW_MS = 60 * 60 * 1000;

export interface CounterpartyProfile {
  userId: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  vendorId: string | null;
  vendorSlug: string | null;
  vendorName: Record<string, string> | null;
}

export interface ConversationListResult {
  data: {
    conversation: Conversation;
    counterparty: CounterpartyProfile;
    lastMessage: Message | null;
    unreadCount: number;
    isArchived: boolean;
  }[];
  nextCursor: string | null;
}

@Injectable()
export class ChatService {
  private readonly log = new Logger(ChatService.name);

  constructor(
    private readonly chat: ChatAbstractRepository,
    private readonly users: UsersService,
    private readonly vendors: VendorsService,
    private readonly files: FilesService,
    private readonly redis: RedisService,
    @InjectQueue('push-message') private readonly pushQueue: Queue<ChatPushJob>,
    @InjectQueue('image-thumb') private readonly imageThumbQueue: Queue,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  // ── Conversations ─────────────────────────────────────────────────

  async listConversations(
    userId: number,
    opts: { cursor?: string; limit?: number; archived?: boolean },
  ): Promise<ConversationListResult> {
    const limit = Math.min(opts.limit ?? 30, 100);
    const cursor = opts.cursor ? new Date(opts.cursor) : null;
    const archived = opts.archived ?? false;
    const items = await this.chat.listConversationsForUser({
      userId,
      cursor,
      limit,
      archived,
    });
    const nextCursor =
      items.length === limit
        ? items[items.length - 1].conversation.lastMessageAt.toISOString()
        : null;
    const enriched = await Promise.all(
      items.map(async (item) => ({
        conversation: item.conversation,
        counterparty: await this.buildCounterpartyProfile(item),
        lastMessage: item.lastMessage,
        unreadCount: item.unreadCount,
        isArchived: item.isArchived,
      })),
    );
    return { data: enriched, nextCursor };
  }

  private async buildCounterpartyProfile(
    item: ConversationListItem,
  ): Promise<CounterpartyProfile> {
    const userId = item.counterpartyUserId;
    const profile: CounterpartyProfile = {
      userId,
      firstName: null,
      lastName: null,
      email: null,
      vendorId: null,
      vendorSlug: null,
      vendorName: null,
    };
    if (userId > 0) {
      const u = await this.users.findById(userId);
      if (u) {
        profile.firstName = u.firstName ?? null;
        profile.lastName = u.lastName ?? null;
        profile.email = u.email ?? null;
      }
    }
    if (item.counterpartyVendorId) {
      const byId = await this.vendors.findById(item.counterpartyVendorId);
      if (byId) {
        profile.vendorId = byId.id;
        profile.vendorSlug = byId.slug;
        profile.vendorName = byId.nameTranslations;
      }
    }
    return profile;
  }

  async createConversation(
    userId: number,
    input: { kind: ConversationKind; vendorId?: string; subOrderId?: string },
  ): Promise<Conversation> {
    if (input.kind === ConversationKind.DIRECT) {
      return this.createDirect(userId, input.vendorId);
    } else {
      return this.createForOrder(userId, input.subOrderId);
    }
  }

  private async createDirect(
    userId: number,
    vendorId: string | undefined,
  ): Promise<Conversation> {
    if (!vendorId) {
      throw new UnprocessableEntityException(
        'vendorId is required for DIRECT conversations',
      );
    }
    const vendor = await this.vendors.findById(vendorId);
    if (!vendor) throw new NotFoundException('Vendor not found');

    // Buyer-initiates rule: a vendor cannot initiate a DIRECT to a buyer.
    // The caller must NOT be the vendor's owner.
    if (vendor.userId === userId) {
      throw new ForbiddenException(
        'Vendors cannot initiate DIRECT conversations with buyers',
      );
    }

    const buyerId = userId;
    const existing = await this.chat.findDirectByPair(vendor.id, buyerId);
    if (existing) return existing;

    // Check block (either side).
    if (await this.chat.isEitherBlocked(buyerId, vendor.userId)) {
      throw new ForbiddenException(
        'Cannot start a conversation: blocked by counterparty',
      );
    }

    const id = uuidv7Generate();
    return this.chat.createConversation({
      conversation: {
        id,
        kind: ConversationKind.DIRECT,
        vendorId: vendor.id,
        buyerId,
        subOrderId: null,
      },
      participants: [
        {
          id: uuidv7Generate(),
          conversationId: id,
          userId: buyerId,
        },
        {
          id: uuidv7Generate(),
          conversationId: id,
          userId: vendor.userId,
        },
      ],
    });
  }

  private async createForOrder(
    userId: number,
    subOrderId: string | undefined,
  ): Promise<Conversation> {
    if (!subOrderId) {
      throw new UnprocessableEntityException(
        'subOrderId is required for ORDER conversations',
      );
    }

    // Resolve the sub-order to its order (for buyerId) and vendor.
    const row = await this.dataSource
      .getRepository(SubOrderEntity)
      .createQueryBuilder('so')
      .innerJoinAndSelect('so.order', 'o')
      .innerJoinAndSelect('so.vendor', 'v')
      .where('so.id = :id', { id: subOrderId })
      .getOne();
    if (!row) throw new NotFoundException('SubOrder not found');

    const buyerId = row.order.buyerId;
    const vendorUserId = row.vendor.userId;

    // Caller must be either the buyer or the vendor of this suborder.
    if (userId !== buyerId && userId !== vendorUserId) {
      throw new ForbiddenException(
        'You are not a participant of this sub-order',
      );
    }

    const existing = await this.chat.findOrderConversation(subOrderId);
    if (existing) return existing;

    const id = uuidv7Generate();
    return this.chat.createConversation({
      conversation: {
        id,
        kind: ConversationKind.ORDER,
        vendorId: row.vendorId,
        buyerId,
        subOrderId,
      },
      participants: [
        {
          id: uuidv7Generate(),
          conversationId: id,
          userId: buyerId,
        },
        {
          id: uuidv7Generate(),
          conversationId: id,
          userId: vendorUserId,
        },
      ],
    });
  }

  // ── Messages ──────────────────────────────────────────────────────

  async listMessages(
    callerUserId: number,
    conversationId: string,
    opts: { cursor?: string; limit?: number },
  ): Promise<{ data: Message[]; nextCursor: string | null }> {
    await this.assertParticipant(conversationId, callerUserId);
    const limit = Math.min(opts.limit ?? 30, 100);
    const cursor = opts.cursor ? new Date(opts.cursor) : null;
    const messages = await this.chat.listMessages({
      conversationId,
      cursor,
      limit,
    });
    // Returned oldest-first; cursor for the next page is the OLDEST message's createdAt.
    const nextCursor =
      messages.length === limit && messages.length > 0
        ? messages[0].createdAt.toISOString()
        : null;
    return { data: messages, nextCursor };
  }

  async sendMessage(
    callerUserId: number,
    conversationId: string,
    input: { body?: string; attachmentFileIds?: string[] },
  ): Promise<Message> {
    const convo = await this.chat.findConversationById(conversationId);
    if (!convo) throw new NotFoundException('Conversation not found');
    await this.assertParticipant(conversationId, callerUserId);

    // Block check: bilateral. Resolve counterparty user.
    const participants = await this.chat.listParticipants(conversationId);
    const counterparty = participants.find((p) => p.userId !== callerUserId);
    if (counterparty) {
      if (await this.chat.isEitherBlocked(callerUserId, counterparty.userId)) {
        throw new ForbiddenException(
          'Cannot send: blocked relationship with counterparty',
        );
      }
    }
    if (convo.kind === ConversationKind.DIRECT && counterparty) {
      await this.enforceDirectAntiSpam({
        convo,
        senderUserId: callerUserId,
        recipientUserId: counterparty.userId,
      });
    }

    const body = (input.body ?? '').trim();
    const attachmentIds = input.attachmentFileIds ?? [];
    if (body.length === 0 && attachmentIds.length === 0) {
      throw new UnprocessableEntityException(
        'Message must have body or at least one attachment',
      );
    }
    if (body.length > MAX_BODY_LEN) {
      throw new UnprocessableEntityException(
        `Message body must be ≤ ${MAX_BODY_LEN} chars`,
      );
    }
    if (attachmentIds.length > MAX_ATTACHMENTS) {
      throw new UnprocessableEntityException(
        `At most ${MAX_ATTACHMENTS} attachments per message`,
      );
    }

    const attachmentFiles: FileType[] = [];
    for (const fid of attachmentIds) {
      const f = await this.files.findById(fid);
      if (!f) {
        throw new UnprocessableEntityException(
          `attachment file_id ${fid} not found`,
        );
      }
      if (f.userId !== callerUserId || f.purpose !== CHAT_ATTACHMENT_PURPOSE) {
        throw new UnprocessableEntityException('attachment_not_owned_by_user');
      }
      if (!f.isConfirmed) {
        throw new UnprocessableEntityException('attachment_not_confirmed');
      }
      if ((f.sizeBytes ?? 0) > 25 * 1024 * 1024) {
        throw new UnprocessableEntityException('attachment_file_too_large');
      }
      if (
        !f.mimeType ||
        !CHAT_ATTACHMENT_MIME_WHITELIST.includes(
          f.mimeType as (typeof CHAT_ATTACHMENT_MIME_WHITELIST)[number],
        )
      ) {
        throw new UnprocessableEntityException('attachment_mime_not_allowed');
      }
      attachmentFiles.push(f);
    }

    const id = uuidv7Generate();
    const message = await this.chat.createMessage({
      id,
      conversationId,
      senderUserId: callerUserId,
      body,
      attachments: attachmentIds.map((fid, idx) => ({
        id: uuidv7Generate(),
        fileId: fid,
        kind: attachmentFiles[idx]?.mimeType?.startsWith('image/')
          ? MessageAttachmentKind.IMAGE
          : MessageAttachmentKind.FILE,
        position: idx,
      })),
    });
    await this.onMessagePersisted({
      convo,
      message,
      senderUserId: callerUserId,
      participants,
      body,
      attachmentMimeTypes: attachmentFiles.map((file) => file.mimeType ?? ''),
    });
    return message;
  }

  async markRead(
    callerUserId: number,
    conversationId: string,
    messageId?: string,
  ): Promise<void> {
    await this.assertParticipant(conversationId, callerUserId);
    let target = messageId ?? null;
    if (target) {
      const m = await this.chat.findMessageById(target);
      if (!m || m.conversationId !== conversationId) {
        throw new UnprocessableEntityException(
          'messageId does not belong to this conversation',
        );
      }
    } else {
      target = await this.chat.latestMessageId(conversationId);
    }
    await this.chat.setLastReadMessage(conversationId, callerUserId, target);
  }

  async setArchived(
    callerUserId: number,
    conversationId: string,
    archived: boolean,
  ): Promise<void> {
    await this.assertParticipant(conversationId, callerUserId);
    await this.chat.setArchived(conversationId, callerUserId, archived);
  }

  // ── Block ─────────────────────────────────────────────────────────

  async block(callerUserId: number, targetUserId: number): Promise<void> {
    if (callerUserId === targetUserId) {
      throw new UnprocessableEntityException('Cannot block yourself');
    }
    const target = await this.users.findById(targetUserId);
    if (!target) throw new NotFoundException('Target user not found');
    if ((target as { role?: { id: number } }).role?.id === RoleEnum.admin) {
      throw new ForbiddenException('Cannot block administrators');
    }
    const existing = await this.chat.findBlock(callerUserId, targetUserId);
    if (existing) return;
    await this.chat.createBlock(uuidv7Generate(), callerUserId, targetUserId);
  }

  async unblock(callerUserId: number, targetUserId: number): Promise<void> {
    await this.chat.removeBlock(callerUserId, targetUserId);
  }

  // ── Reports ───────────────────────────────────────────────────────

  async report(
    callerUserId: number,
    conversationId: string,
    reason: string,
  ): Promise<ConversationReport> {
    await this.assertParticipant(conversationId, callerUserId);
    const dup = await this.chat.findOpenReportBy(conversationId, callerUserId);
    if (dup) {
      throw new UnprocessableEntityException(
        'You already have an open report for this conversation',
      );
    }
    return this.chat.createReport(
      uuidv7Generate(),
      conversationId,
      callerUserId,
      reason,
    );
  }

  async listReports(opts: {
    status?: ConversationReportStatus;
    page?: number;
    limit?: number;
  }): Promise<{ data: ConversationReport[]; total: number }> {
    return this.chat.listReports({
      status: opts.status,
      page: opts.page ?? 1,
      limit: Math.min(opts.limit ?? 20, 100),
    });
  }

  async getReport(reportId: string): Promise<ConversationReport> {
    const r = await this.chat.findReportById(reportId);
    if (!r) throw new NotFoundException('Report not found');
    return r;
  }

  async updateReportStatus(
    reportId: string,
    status: ConversationReportStatus,
  ): Promise<ConversationReport> {
    const existing = await this.chat.findReportById(reportId);
    if (!existing) throw new NotFoundException('Report not found');
    return this.chat.updateReportStatus(reportId, status);
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private async assertParticipant(
    conversationId: string,
    userId: number,
  ): Promise<void> {
    const part = await this.chat.findParticipant(conversationId, userId);
    if (!part) {
      // Verify the conversation exists to differentiate 404 vs 403.
      const exists = await this.chat.findConversationById(conversationId);
      if (!exists) throw new NotFoundException('Conversation not found');
      throw new ForbiddenException(
        'You are not a participant of this conversation',
      );
    }
  }

  private async enforceDirectAntiSpam(input: {
    convo: Conversation;
    senderUserId: number;
    recipientUserId: number;
  }): Promise<void> {
    const recipientReplies = await this.chat.countDirectMessagesFromUser({
      vendorId: input.convo.vendorId,
      buyerId: input.convo.buyerId,
      senderUserId: input.recipientUserId,
    });
    if (recipientReplies > 0) return;

    const now = Date.now();
    const key = `chat:direct-unreplied:${input.senderUserId}:${input.recipientUserId}`;
    const redis = this.redis.raw();
    await redis.zremrangebyscore(key, 0, now - DIRECT_UNREPLIED_WINDOW_MS);
    const count = await redis.zcard(key);
    if (count >= DIRECT_UNREPLIED_LIMIT) {
      const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES');
      const retryAfter = Math.max(
        1,
        Math.ceil(
          (Number(oldest[1] ?? now) + DIRECT_UNREPLIED_WINDOW_MS - now) / 1000,
        ),
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'rate_limited',
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await redis
      .multi()
      .zadd(key, now, `${now}:${uuidv7Generate()}`)
      .pexpire(key, DIRECT_UNREPLIED_WINDOW_MS)
      .exec();
  }

  private async relaxDirectAntiSpamOnFirstReply(input: {
    convo: Conversation;
    senderUserId: number;
    recipientUserId: number;
  }): Promise<void> {
    if (input.convo.kind !== ConversationKind.DIRECT) return;
    const priorMessagesFromSender = await this.chat.countDirectMessagesFromUser(
      {
        vendorId: input.convo.vendorId,
        buyerId: input.convo.buyerId,
        senderUserId: input.senderUserId,
      },
    );
    if (priorMessagesFromSender !== 1) return;
    await this.redis
      .raw()
      .del(
        `chat:direct-unreplied:${input.recipientUserId}:${input.senderUserId}`,
      );
  }

  private async onMessagePersisted(input: {
    convo: Conversation;
    message: Message;
    senderUserId: number;
    participants: { userId: number }[];
    body: string;
    attachmentMimeTypes: string[];
  }): Promise<void> {
    const recipients = input.participants
      .filter((p) => p.userId !== input.senderUserId)
      .map((p) => p.userId);
    const offlineRecipients: number[] = [];
    for (const recipient of recipients) {
      if (!(await this.isOnline(recipient))) offlineRecipients.push(recipient);
    }
    if (offlineRecipients.length > 0) {
      await this.pushQueue.add(
        'push:message',
        {
          conversationId: input.convo.id,
          messageId: input.message.id,
          recipientUserIds: offlineRecipients,
          senderUserId: input.senderUserId,
          senderName: await this.senderDisplayName(
            input.convo,
            input.senderUserId,
          ),
          bodyPreview: this.buildBodyPreview(
            input.body,
            input.message.attachments.length,
          ),
          conversationKind: input.convo.kind,
        },
        { removeOnComplete: 100, removeOnFail: 100 },
      );
    }

    for (const attachment of input.message.attachments) {
      if (attachment.kind === MessageAttachmentKind.IMAGE) {
        await this.imageThumbQueue.add(
          'image:thumb',
          { fileId: attachment.fileId },
          { removeOnComplete: 100, removeOnFail: 100 },
        );
      }
    }

    const counterparty = recipients[0];
    if (counterparty) {
      await this.relaxDirectAntiSpamOnFirstReply({
        convo: input.convo,
        senderUserId: input.senderUserId,
        recipientUserId: counterparty,
      });
    }
  }

  private async isOnline(userId: number): Promise<boolean> {
    try {
      return (
        (await this.redis
          .raw()
          .sismember('presence:online', String(userId))) === 1
      );
    } catch (error) {
      this.log.warn(
        `Presence check failed; treating user ${userId} as offline: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  private async senderDisplayName(
    convo: Conversation,
    senderUserId: number,
  ): Promise<string> {
    if (convo.vendorId) {
      const vendor = await this.vendors.findById(convo.vendorId);
      if (vendor?.userId === senderUserId) {
        return (
          vendor.nameTranslations.en ??
          Object.values(vendor.nameTranslations)[0] ??
          'Vendor'
        );
      }
    }
    const user = await this.users.findById(senderUserId);
    return user?.firstName ?? user?.email ?? 'User';
  }

  private buildBodyPreview(body: string, attachmentCount: number): string {
    if (body.length > 0) return body.slice(0, 80);
    return `📎 ${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}`;
  }
}

// Side effect: keep `OrderEntity` import alive (used by typeorm metadata only
// in the future when we cross-load relations). Avoid tree-shake.
void OrderEntity;
void VendorEntity;
