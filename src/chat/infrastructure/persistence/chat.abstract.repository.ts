import { ConversationKind } from '../../domain/chat-enums';
import { Conversation } from '../../domain/conversation';
import { ConversationParticipant } from '../../domain/conversation-participant';
import { ConversationReport } from '../../domain/conversation-report';
import { Message } from '../../domain/message';
import { UserBlock } from '../../domain/user-block';

export interface CreateConversationRow {
  id: string;
  kind: ConversationKind;
  vendorId: string;
  buyerId: number;
  subOrderId: string | null;
}

export interface CreateParticipantRow {
  id: string;
  conversationId: string;
  userId: number;
}

export interface CreateConversationInput {
  conversation: CreateConversationRow;
  participants: CreateParticipantRow[];
}

export interface CreateMessageInput {
  id: string;
  conversationId: string;
  senderUserId: number;
  body: string;
  attachments: {
    id: string;
    fileId: string;
    kind: string;
    position: number;
  }[];
}

export interface ListConversationsForUserOptions {
  userId: number;
  archived: boolean;
  cursor: Date | null;
  limit: number;
}

export interface ConversationListItem {
  conversation: Conversation;
  counterpartyUserId: number;
  counterpartyVendorId: string | null;
  isArchived: boolean;
  lastReadMessageId: string | null;
  lastMessage: Message | null;
  unreadCount: number;
}

export interface ListMessagesOptions {
  conversationId: string;
  cursor: Date | null;
  limit: number;
}

export abstract class ChatAbstractRepository {
  // Conversations
  abstract findConversationById(id: string): Promise<Conversation | null>;
  abstract findDirectByPair(
    vendorId: string,
    buyerId: number,
  ): Promise<Conversation | null>;
  abstract findOrderConversation(
    subOrderId: string,
  ): Promise<Conversation | null>;
  abstract createConversation(
    input: CreateConversationInput,
  ): Promise<Conversation>;
  abstract listConversationsForUser(
    opts: ListConversationsForUserOptions,
  ): Promise<ConversationListItem[]>;
  abstract updateLastMessageAt(
    conversationId: string,
    when: Date,
  ): Promise<void>;

  // Participants
  abstract listParticipants(
    conversationId: string,
  ): Promise<ConversationParticipant[]>;
  abstract findParticipant(
    conversationId: string,
    userId: number,
  ): Promise<ConversationParticipant | null>;
  abstract setLastReadMessage(
    conversationId: string,
    userId: number,
    messageId: string | null,
  ): Promise<void>;
  abstract setArchived(
    conversationId: string,
    userId: number,
    archived: boolean,
  ): Promise<void>;

  // Messages
  abstract createMessage(input: CreateMessageInput): Promise<Message>;
  abstract findMessageById(id: string): Promise<Message | null>;
  abstract listMessages(opts: ListMessagesOptions): Promise<Message[]>;
  abstract latestMessageId(conversationId: string): Promise<string | null>;
  abstract countDirectMessagesFromUser(input: {
    vendorId: string;
    buyerId: number;
    senderUserId: number;
  }): Promise<number>;

  // User block
  abstract findBlock(
    blockerUserId: number,
    blockedUserId: number,
  ): Promise<UserBlock | null>;
  abstract isEitherBlocked(userA: number, userB: number): Promise<boolean>;
  abstract createBlock(
    id: string,
    blockerUserId: number,
    blockedUserId: number,
  ): Promise<UserBlock>;
  abstract removeBlock(
    blockerUserId: number,
    blockedUserId: number,
  ): Promise<boolean>;

  // Reports
  abstract findOpenReportBy(
    conversationId: string,
    reporterUserId: number,
  ): Promise<ConversationReport | null>;
  abstract createReport(
    id: string,
    conversationId: string,
    reporterUserId: number,
    reason: string,
  ): Promise<ConversationReport>;
  abstract findReportById(id: string): Promise<ConversationReport | null>;
  abstract listReports(opts: {
    status?: string;
    page: number;
    limit: number;
  }): Promise<{ data: ConversationReport[]; total: number }>;
  abstract updateReportStatus(
    id: string,
    status: string,
  ): Promise<ConversationReport>;
}
