import request from 'supertest';
import { ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL } from '../utils/constants';

describe('Admin · Settings (e2e)', () => {
  let adminToken = '';

  beforeAll(async () => {
    const res = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    adminToken = res.body.token as string;
  });

  it('should list current settings', async () => {
    const res = await request(APP_URL)
      .get('/api/v1/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('multi_region_enabled');
    expect(res.body).toHaveProperty('vendors_auto_approve');
    expect(res.body).toHaveProperty('default_region_code');
  });

  it('should return one setting by key', async () => {
    const res = await request(APP_URL)
      .get('/api/v1/admin/settings/multi_region_enabled')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      key: 'multi_region_enabled',
      value: expect.any(Boolean),
    });
  });

  it('should reject unknown keys with 422', async () => {
    const res = await request(APP_URL)
      .patch('/api/v1/admin/settings/totally_made_up')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: true });
    expect(res.status).toBe(422);
  });

  it('should reject wrong-type values with 422', async () => {
    const res = await request(APP_URL)
      .patch('/api/v1/admin/settings/multi_region_enabled')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: 'not-a-bool' });
    expect(res.status).toBe(422);
  });

  it('should update a setting and write an audit log row on PATCH', async () => {
    // Read current value so we can flip and restore.
    const before = await request(APP_URL)
      .get('/api/v1/admin/settings/multi_region_enabled')
      .set('Authorization', `Bearer ${adminToken}`);
    const previous = before.body.value as boolean;
    const next = !previous;

    const patch = await request(APP_URL)
      .patch('/api/v1/admin/settings/multi_region_enabled')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: next });
    expect(patch.status).toBe(200);
    expect(patch.body).toEqual({
      key: 'multi_region_enabled',
      value: next,
    });

    // Audit log must contain the change.
    const audit = await request(APP_URL)
      .get(`/api/v1/admin/audit-log?action=settings.update&targetType=setting`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(audit.status).toBe(200);
    expect(audit.body.total).toBeGreaterThan(0);
    const matching = (
      audit.body.data as Array<{
        targetId: string;
        payload: { from: unknown; to: unknown };
      }>
    ).find((row) => row.targetId === 'multi_region_enabled');
    expect(matching).toBeTruthy();
    expect(matching!.payload).toEqual({ from: previous, to: next });

    // Restore previous value so this test is idempotent across re-runs.
    await request(APP_URL)
      .patch('/api/v1/admin/settings/multi_region_enabled')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: previous });
  });

  it('should treat default_region_id as an alias for default_region_code', async () => {
    const get = await request(APP_URL)
      .get('/api/v1/admin/settings/default_region_id')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(get.status).toBe(200);
    expect(get.body.key).toBe('default_region_code');
  });

  it('should hide admin-only keys on the public endpoint', async () => {
    const res = await request(APP_URL).get('/api/v1/settings/public');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('multi_region_enabled');
    expect(res.body).toHaveProperty('default_region_code');
    expect(res.body).toHaveProperty('default_locale_code');
    expect(res.body).not.toHaveProperty('vendors_auto_approve');
    expect(res.body).not.toHaveProperty('products_auto_approve');
  });

  it('should reject admin endpoints without admin role', async () => {
    const res = await request(APP_URL).get('/api/v1/admin/settings');
    expect(res.status).toBe(401);
  });
});
