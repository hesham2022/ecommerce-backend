import { HttpException } from '@nestjs/common';
import { ConversationKind } from './domain/chat-enums';
import { ChatService } from './chat.service';

describe('ChatService anti-spam', () => {
  const convo = {
    id: '0196a72e-5657-7d96-8c53-cefdfdc8422e',
    kind: ConversationKind.DIRECT,
    vendorId: '0196a72e-5657-7d96-8c53-cefdfdc8422f',
    buyerId: 1,
  };

  const makeService = (recipientReplyCount: number, zcard: number) => {
    const redis = {
      zremrangebyscore: jest.fn().mockResolvedValue(0),
      zcard: jest.fn().mockResolvedValue(zcard),
      zrange: jest.fn().mockResolvedValue(['member', String(Date.now())]),
      sismember: jest.fn().mockResolvedValue(0),
      del: jest.fn().mockResolvedValue(1),
      multi: jest.fn().mockReturnValue({
        zadd: jest.fn().mockReturnThis(),
        pexpire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
    };
    const chat = {
      findConversationById: jest.fn().mockResolvedValue(convo),
      findParticipant: jest.fn().mockResolvedValue({ userId: 1 }),
      listParticipants: jest
        .fn()
        .mockResolvedValue([{ userId: 1 }, { userId: 2 }]),
      isEitherBlocked: jest.fn().mockResolvedValue(false),
      countDirectMessagesFromUser: jest
        .fn()
        .mockResolvedValue(recipientReplyCount),
      createMessage: jest.fn().mockResolvedValue({
        id: 'message-id',
        attachments: [],
      }),
    };
    const service = new ChatService(
      chat as never,
      {
        findById: jest.fn().mockResolvedValue({ firstName: 'Buyer' }),
      } as never,
      { findById: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      { raw: () => redis } as never,
      { add: jest.fn() } as never,
      { add: jest.fn() } as never,
      {} as never,
      { emitMessageNew: jest.fn() } as never,
    );
    return { chat, redis, service };
  };

  it('should reject the 31st unreplied direct message in the hour', async () => {
    const { service } = makeService(0, 30);

    await expect(
      service.sendMessage(1, convo.id, { body: 'hello' }),
    ).rejects.toThrow(HttpException);
  });

  it('should not increment the spam bucket after the counterparty replied', async () => {
    const { redis, service } = makeService(1, 30);

    await service.sendMessage(1, convo.id, { body: 'hello' });

    expect(redis.zcard).not.toHaveBeenCalled();
  });
});
