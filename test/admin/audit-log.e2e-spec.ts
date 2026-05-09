import request from 'supertest';
import { ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL } from '../utils/constants';

describe('Admin · Audit Log (e2e)', () => {
  let adminToken = '';
  let adminUserId = 0;

  beforeAll(async () => {
    const res = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    adminToken = res.body.token as string;
    adminUserId = res.body.user.id as number;
  });

  beforeAll(async () => {
    // Trigger at least one audit row by toggling vendors_auto_approve twice
    // (we restore to the original value at the end so this stays idempotent).
    const before = await request(APP_URL)
      .get('/api/v1/admin/settings/vendors_auto_approve')
      .set('Authorization', `Bearer ${adminToken}`);
    const original = before.body.value as boolean;
    await request(APP_URL)
      .patch('/api/v1/admin/settings/vendors_auto_approve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: !original });
    await request(APP_URL)
      .patch('/api/v1/admin/settings/vendors_auto_approve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: original });
  });

  it('should list audit log rows newest first', async () => {
    const res = await request(APP_URL)
      .get('/api/v1/admin/audit-log')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('total');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.total).toBeGreaterThan(0);
  });

  it('should filter by action', async () => {
    const res = await request(APP_URL)
      .get('/api/v1/admin/audit-log?action=settings.update')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const row of res.body.data as Array<{ action: string }>) {
      expect(row.action).toBe('settings.update');
    }
  });

  it('should filter by adminUserId', async () => {
    const res = await request(APP_URL)
      .get(`/api/v1/admin/audit-log?adminUserId=${adminUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    for (const row of res.body.data as Array<{ adminUserId: number }>) {
      expect(row.adminUserId).toBe(adminUserId);
    }
  });

  it('should filter by an action that has no rows', async () => {
    const res = await request(APP_URL)
      .get('/api/v1/admin/audit-log?action=does.not.exist')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.data).toEqual([]);
  });

  it('should reject without admin role', async () => {
    const res = await request(APP_URL).get('/api/v1/admin/audit-log');
    expect(res.status).toBe(401);
  });
});
