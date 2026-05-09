import { ConversationKind } from '../domain/chat-enums';
import { buildChatPushPayload } from './chat-push.payload';

describe('buildChatPushPayload', () => {
  it('should build the chat message push payload shape', () => {
    expect(
      buildChatPushPayload({
        conversationId: '0196a72e-5657-7d96-8c53-cefdfdc8422e',
        messageId: '0196a72e-5657-7d96-8c53-cefdfdc8422f',
        recipientUserIds: [2],
        senderUserId: 1,
        senderName: 'Sample Shop',
        bodyPreview: 'Hello',
        conversationKind: ConversationKind.DIRECT,
      }),
    ).toEqual({
      notification: { title: 'Sample Shop', body: 'Hello' },
      data: {
        type: 'chat.message',
        conversationId: '0196a72e-5657-7d96-8c53-cefdfdc8422e',
        messageId: '0196a72e-5657-7d96-8c53-cefdfdc8422f',
        conversationKind: ConversationKind.DIRECT,
        senderUserId: '1',
        deepLink: '/chat/0196a72e-5657-7d96-8c53-cefdfdc8422e',
      },
    });
  });
});
