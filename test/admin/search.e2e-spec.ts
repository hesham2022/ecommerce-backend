import request from 'supertest';
import { ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL } from '../utils/constants';

describe('Admin · Search (e2e)', () => {
  let adminToken = '';
  const ts = Date.now();
  const vendorEmail = `search-vendor-${ts}@example.com`;
  const vendorPassword = 'Pass1234!';
  const vendorName = `SearchableShop${ts}`;

  beforeAll(async () => {
    const login = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(login.status).toBe(200);
    adminToken = login.body.token as string;

    // Seed: a vendor whose name contains a known unique substring.
    await request(APP_URL).post('/api/v1/vendor/signup').send({
      email: vendorEmail,
      password: vendorPassword,
      firstName: 'Search',
      lastName: 'Test',
      name: vendorName,
    });
  });

  it('should return vendors / products / orders / users buckets when type omitted', async () => {
    const res = await request(APP_URL)
      .get(`/api/v1/admin/search?q=${encodeURIComponent(vendorName)}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('vendors');
    expect(res.body).toHaveProperty('products');
    expect(res.body).toHaveProperty('orders');
    expect(res.body).toHaveProperty('users');
    expect(Array.isArray(res.body.vendors)).toBe(true);
    expect(res.body.vendors.length).toBeGreaterThan(0);
    expect(
      res.body.vendors.some((v: { slug: string }) =>
        v.slug.includes('searchableshop'),
      ),
    ).toBe(true);
  });

  it('should narrow the response to vendors only when type=vendor', async () => {
    const res = await request(APP_URL)
      .get(
        `/api/v1/admin/search?q=${encodeURIComponent(vendorName)}&type=vendor`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.vendors.length).toBeGreaterThan(0);
    expect(res.body.products).toEqual([]);
    expect(res.body.orders).toEqual([]);
    expect(res.body.users).toEqual([]);
  });

  it('should match by email when type=user', async () => {
    const res = await request(APP_URL)
      .get(
        `/api/v1/admin/search?q=${encodeURIComponent(vendorEmail.split('@')[0])}&type=user`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.users.length).toBeGreaterThan(0);
    expect(
      res.body.users.some(
        (u: { email: string | null }) => u.email === vendorEmail,
      ),
    ).toBe(true);
  });

  it('should cap at limit', async () => {
    const res = await request(APP_URL)
      .get('/api/v1/admin/search?q=a&limit=2')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.vendors.length).toBeLessThanOrEqual(2);
    expect(res.body.products.length).toBeLessThanOrEqual(2);
    expect(res.body.users.length).toBeLessThanOrEqual(2);
  });

  it('should reject an empty q', async () => {
    const res = await request(APP_URL)
      .get('/api/v1/admin/search?q=')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(422);
  });

  it('should reject non-admin', async () => {
    const res = await request(APP_URL).get('/api/v1/admin/search?q=foo');
    expect(res.status).toBe(401);
  });
});
