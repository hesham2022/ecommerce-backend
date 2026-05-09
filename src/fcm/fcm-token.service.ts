import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { uuidv7Generate } from '../utils/uuid';
import { FcmPlatform, FcmTokenEntity } from './entities/fcm-token.entity';

@Injectable()
export class FcmTokenService {
  constructor(
    @InjectRepository(FcmTokenEntity)
    private readonly tokens: Repository<FcmTokenEntity>,
  ) {}

  async upsert(input: {
    userId: number;
    token: string;
    platform: FcmPlatform;
    deviceId: string;
  }): Promise<FcmTokenEntity> {
    const existing = await this.tokens.findOne({
      where: { token: input.token },
    });
    if (existing) {
      existing.userId = input.userId;
      existing.platform = input.platform;
      existing.deviceId = input.deviceId;
      existing.lastUsedAt = new Date();
      return this.tokens.save(existing);
    }

    return this.tokens.save(
      this.tokens.create({
        id: uuidv7Generate(),
        userId: input.userId,
        token: input.token,
        platform: input.platform,
        deviceId: input.deviceId,
        lastUsedAt: new Date(),
      }),
    );
  }

  async deleteForUser(userId: number, token: string): Promise<void> {
    await this.tokens.delete({ userId, token });
  }

  async findByUserIds(userIds: number[]): Promise<FcmTokenEntity[]> {
    if (userIds.length === 0) return [];
    return this.tokens.find({ where: { userId: In(userIds) } });
  }

  async touchTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    await this.tokens.update({ token: In(tokens) }, { lastUsedAt: new Date() });
  }

  async deleteTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    await this.tokens.delete({ token: In(tokens) });
  }
}
