import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { uuidv7Generate } from '../utils/uuid';
import { UsersService } from '../users/users.service';
import { VendorsService } from '../vendors/vendors.service';
import { RoleEnum } from '../roles/roles.enum';
import { FilesService } from '../files/files.service';
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
import { ChatRealtimeBus } from './realtime/chat-realtime.bus';

const MAX_BODY_LEN = 5000;
const MAX_ATTACHMENTS = 5;

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
  constructor(
    private readonly chat: ChatAbstractRepository,
    private readonly users: UsersService,
    private readonly vendors: VendorsService,
    private readonly files: FilesService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly realtimeBus: ChatRealtimeBus,
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

    // Validate file ownership by checking they exist. (Files module
    // doesn't carry an owner field in v1; the presign+confirm slice
    // will tighten this. For now we only ensure the file row exists.)
    for (const fid of attachmentIds) {
      const f = await this.files.findById(fid);
      if (!f) {
        throw new UnprocessableEntityException(
          `attachment file_id ${fid} not found`,
        );
      }
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
        kind: MessageAttachmentKind.FILE,
        position: idx,
      })),
    });
    // Fan out via the realtime bus (gateway listens). Single emit point —
    // both REST and WS converge here, so no double-broadcast.
    this.realtimeBus.emitMessageNew({
      conversationId,
      message,
      recipientUserIds: participants.map((p) => p.userId),
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
    this.realtimeBus.emitMessageRead({
      conversationId,
      userId: callerUserId,
      messageId: target,
    });
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
}

// Side effect: keep `OrderEntity` import alive (used by typeorm metadata only
// in the future when we cross-load relations). Avoid tree-shake.
void OrderEntity;
void VendorEntity;
