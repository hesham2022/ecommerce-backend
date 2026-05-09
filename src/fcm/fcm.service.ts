import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'fs';
import * as admin from 'firebase-admin';
import { MulticastMessage } from 'firebase-admin/messaging';

export interface FcmSendResult {
  successTokens: string[];
  staleTokens: string[];
  failedTokens: string[];
}

@Injectable()
export class FcmService implements OnModuleInit {
  private readonly log = new Logger(FcmService.name);
  private app: admin.app.App | null = null;

  onModuleInit(): void {
    const path = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (!path) {
      this.log.warn(
        'FIREBASE_SERVICE_ACCOUNT is not set; FCM push is disabled',
      );
      return;
    }

    try {
      const serviceAccount = JSON.parse(readFileSync(path, 'utf8')) as object;
      this.app =
        admin.apps.length > 0
          ? admin.app()
          : admin.initializeApp({
              credential: admin.credential.cert(serviceAccount),
            });
    } catch (error) {
      this.log.warn(
        `Failed to initialize Firebase Admin SDK; FCM push is disabled: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.app = null;
    }
  }

  async sendEachForMulticast(
    message: Omit<MulticastMessage, 'tokens'>,
    tokens: string[],
  ): Promise<FcmSendResult> {
    if (tokens.length === 0) {
      return { successTokens: [], staleTokens: [], failedTokens: [] };
    }
    if (!this.app) {
      this.log.warn(
        'Skipping FCM send because Firebase Admin is not configured',
      );
      return { successTokens: [], staleTokens: [], failedTokens: tokens };
    }

    const response = await this.app.messaging().sendEachForMulticast({
      ...message,
      tokens,
    });
    const successTokens: string[] = [];
    const staleTokens: string[] = [];
    const failedTokens: string[] = [];

    response.responses.forEach((result, index) => {
      const token = tokens[index];
      if (result.success) {
        successTokens.push(token);
        return;
      }
      const code = result.error?.code;
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        staleTokens.push(token);
      } else {
        failedTokens.push(token);
      }
    });

    return { successTokens, staleTokens, failedTokens };
  }
}
