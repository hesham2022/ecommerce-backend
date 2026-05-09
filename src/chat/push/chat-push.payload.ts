import { ConversationKind } from '../domain/chat-enums';

export interface ChatPushJob {
  conversationId: string;
  messageId: string;
  recipientUserIds: number[];
  senderUserId: number;
  senderName: string;
  bodyPreview: string;
  conversationKind: ConversationKind;
}

export function buildChatPushPayload(job: ChatPushJob) {
  return {
    notification: {
      title: job.senderName,
      body: job.bodyPreview,
    },
    data: {
      type: 'chat.message',
      conversationId: job.conversationId,
      messageId: job.messageId,
      conversationKind: job.conversationKind,
      senderUserId: String(job.senderUserId),
      deepLink: `/chat/${job.conversationId}`,
    },
  };
}
