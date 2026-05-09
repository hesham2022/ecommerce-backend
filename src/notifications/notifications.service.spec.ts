import { Test } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { NotificationAbstractRepository } from './infrastructure/persistence/notification.abstract.repository';
import { Notification } from './domain/notification';

class InMemoryNotificationRepo implements NotificationAbstractRepository {
  rows: Notification[] = [];

  create(input: {
    id: string;
    userId: number;
    type: string;
    titleTranslations: Record<string, string>;
    bodyTranslations: Record<string, string>;
    data: Record<string, unknown>;
  }): Promise<Notification> {
    const n = new Notification();
    n.id = input.id;
    n.userId = input.userId;
    n.type = input.type;
    n.titleTranslations = input.titleTranslations;
    n.bodyTranslations = input.bodyTranslations;
    n.data = input.data;
    n.isRead = false;
    n.createdAt = new Date();
    n.readAt = null;
    this.rows.unshift(n);
    return Promise.resolve(n);
  }

  list(opts: {
    userId: number;
    cursor?: string | null;
    limit: number;
    unreadOnly?: boolean;
  }) {
    let items = this.rows.filter((r) => r.userId === opts.userId);
    if (opts.unreadOnly) items = items.filter((r) => !r.isRead);
    if (opts.cursor) {
      const c = new Date(opts.cursor).getTime();
      items = items.filter((r) => r.createdAt.getTime() < c);
    }
    const sliced = items.slice(0, opts.limit);
    const hasMore = items.length > opts.limit;
    return Promise.resolve({
      data: sliced,
      nextCursor:
        hasMore && sliced.length
          ? sliced[sliced.length - 1].createdAt.toISOString()
          : null,
    });
  }

  findOneForUser(id: string, userId: number) {
    return Promise.resolve(
      this.rows.find((r) => r.id === id && r.userId === userId) ?? null,
    );
  }

  markRead(id: string, userId: number) {
    const row = this.rows.find((r) => r.id === id && r.userId === userId);
    if (!row) throw new Error('not found');
    if (!row.isRead) {
      row.isRead = true;
      row.readAt = new Date();
    }
    return Promise.resolve(row);
  }

  markAllRead(userId: number) {
    let updated = 0;
    for (const r of this.rows) {
      if (r.userId === userId && !r.isRead) {
        r.isRead = true;
        r.readAt = new Date();
        updated++;
      }
    }
    return Promise.resolve({ updated });
  }

  unreadCount(userId: number) {
    return Promise.resolve(
      this.rows.filter((r) => r.userId === userId && !r.isRead).length,
    );
  }
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let repo: InMemoryNotificationRepo;

  beforeEach(async () => {
    repo = new InMemoryNotificationRepo();
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: NotificationAbstractRepository, useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(NotificationsService);
  });

  it('should create a notification with isRead=false and a uuid id', async () => {
    const n = await service.create(
      42,
      'order.delivered',
      { en: 'Delivered', ar: 'تم التسليم' },
      { en: 'Your order arrived', ar: 'وصل طلبك' },
      { orderId: 'abc' },
    );
    expect(n.userId).toBe(42);
    expect(n.type).toBe('order.delivered');
    expect(n.isRead).toBe(false);
    expect(n.readAt).toBeNull();
    expect(n.data).toEqual({ orderId: 'abc' });
    expect(typeof n.id).toBe('string');
    expect(n.id.length).toBeGreaterThan(20);
  });

  it('should list notifications newest first', async () => {
    await service.create(1, 'x', { en: 'a' }, { en: 'a' });
    await new Promise((r) => setTimeout(r, 5));
    const newer = await service.create(1, 'y', { en: 'b' }, { en: 'b' });
    const res = await service.list({ userId: 1, limit: 20 });
    expect(res.data[0].id).toBe(newer.id);
  });

  it('should flip is_read and stamp read_at on mark-read', async () => {
    const n = await service.create(1, 'x', { en: 'a' }, { en: 'a' });
    expect(await service.unreadCount(1)).toBe(1);
    const updated = await service.markRead(n.id, 1);
    expect(updated.isRead).toBe(true);
    expect(updated.readAt).toBeInstanceOf(Date);
    expect(await service.unreadCount(1)).toBe(0);
  });

  it('should flip every unread notification for the user on read-all', async () => {
    await service.create(1, 'x', { en: 'a' }, { en: 'a' });
    await service.create(1, 'y', { en: 'b' }, { en: 'b' });
    await service.create(2, 'z', { en: 'c' }, { en: 'c' }); // other user
    const res = await service.markAllRead(1);
    expect(res.updated).toBe(2);
    expect(await service.unreadCount(1)).toBe(0);
    expect(await service.unreadCount(2)).toBe(1);
  });

  it('should trim out already-read rows when unreadOnly filter is set', async () => {
    const a = await service.create(1, 'x', { en: 'a' }, { en: 'a' });
    await service.create(1, 'y', { en: 'b' }, { en: 'b' });
    await service.markRead(a.id, 1);
    const res = await service.list({ userId: 1, limit: 20, unreadOnly: true });
    expect(res.data).toHaveLength(1);
    expect(res.data[0].id).not.toBe(a.id);
  });
});
