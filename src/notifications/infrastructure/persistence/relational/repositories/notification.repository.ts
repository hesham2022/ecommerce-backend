import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Notification } from '../../../../domain/notification';
import {
  CreateNotificationInput,
  ListInboxOptions,
  ListInboxResult,
  NotificationAbstractRepository,
} from '../../notification.abstract.repository';
import { NotificationEntity } from '../entities/notification.entity';
import { NotificationMapper } from '../mappers/notification.mapper';

@Injectable()
export class NotificationRelationalRepository implements NotificationAbstractRepository {
  constructor(
    @InjectRepository(NotificationEntity)
    private readonly repo: Repository<NotificationEntity>,
  ) {}

  async create(input: CreateNotificationInput): Promise<Notification> {
    const row = this.repo.create({
      id: input.id,
      userId: input.userId,
      type: input.type,
      titleTranslations: input.titleTranslations,
      bodyTranslations: input.bodyTranslations,
      data: input.data,
      isRead: false,
      readAt: null,
    });
    const saved = await this.repo.save(row);
    return NotificationMapper.toDomain(saved);
  }

  async list(opts: ListInboxOptions): Promise<ListInboxResult> {
    const { userId, cursor, limit, unreadOnly } = opts;
    // Cursor is the createdAt ISO of the last item from the prev page; we
    // fetch one extra row to know if a next page exists.
    const qb = this.repo
      .createQueryBuilder('n')
      .where('n.userId = :userId', { userId })
      .orderBy('n.createdAt', 'DESC')
      .addOrderBy('n.id', 'DESC')
      .take(limit + 1);

    if (unreadOnly) qb.andWhere('n.isRead = false');
    if (cursor)
      qb.andWhere('n.createdAt < :cursor', { cursor: new Date(cursor) });
    // Reference LessThan so the import isn't unused on the bundled type-check
    void LessThan;

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && sliced.length > 0
        ? sliced[sliced.length - 1].createdAt.toISOString()
        : null;
    return {
      data: sliced.map(NotificationMapper.toDomain),
      nextCursor,
    };
  }

  async findOneForUser(
    id: string,
    userId: number,
  ): Promise<Notification | null> {
    const row = await this.repo.findOne({ where: { id, userId } });
    return row ? NotificationMapper.toDomain(row) : null;
  }

  async markRead(id: string, userId: number): Promise<Notification> {
    const row = await this.repo.findOne({ where: { id, userId } });
    if (!row) throw new NotFoundException('Notification not found');
    if (!row.isRead) {
      row.isRead = true;
      row.readAt = new Date();
      await this.repo.save(row);
    }
    return NotificationMapper.toDomain(row);
  }

  async markAllRead(userId: number): Promise<{ updated: number }> {
    const result = await this.repo
      .createQueryBuilder()
      .update(NotificationEntity)
      .set({ isRead: true, readAt: () => 'now()' })
      .where('user_id = :userId AND is_read = false', { userId })
      .execute();
    return { updated: result.affected ?? 0 };
  }

  async unreadCount(userId: number): Promise<number> {
    return this.repo.count({ where: { userId, isRead: false } });
  }
}
