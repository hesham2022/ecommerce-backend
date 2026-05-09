import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { FcmService } from '../../fcm/fcm.service';
import { FcmTokenService } from '../../fcm/fcm-token.service';
import { buildChatPushPayload, ChatPushJob } from './chat-push.payload';

@Processor('push-message')
export class PushMessageProcessor extends WorkerHost {
  constructor(
    private readonly fcm: FcmService,
    private readonly fcmTokens: FcmTokenService,
  ) {
    super();
  }

  async process(job: Job<ChatPushJob>): Promise<void> {
    const payload = buildChatPushPayload(job.data);
    const tokens = await this.fcmTokens.findByUserIds(
      job.data.recipientUserIds,
    );
    const tokenValues = tokens.map((token) => token.token);
    const result = await this.fcm.sendEachForMulticast(payload, tokenValues);
    await this.fcmTokens.touchTokens(result.successTokens);
    await this.fcmTokens.deleteTokens(result.staleTokens);
  }
}
