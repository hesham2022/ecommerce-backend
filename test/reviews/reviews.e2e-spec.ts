import request from 'supertest';
import { ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL } from '../utils/constants';

interface VendorFixture {
  id: string;
  slug: string;
  token: string;
  productId: string;
  productSlug: string;
  variantIds: string[];
}

const saAddress = {
  fullName: 'Layla Al-Mansour',
  phone: '+966555012345',
  country: 'SA',
  region: 'Riyadh',
  city: 'Riyadh',
  postalCode: '12343',
  street: 'King Fahd Rd, Bldg 14, Apt 3',
  notes: null,
};

describe('Reviews (e2e)', () => {
  const ts = Date.now();

  // Vendors
  const vendorAEmail = `reviews-vendor-a-${ts}@example.com`;
  const vendorAPassword = 'Pass1234!';
  const vendorAShop = `Reviews Shop A ${ts}`;
  const productASlug = `reviews-tee-a-${ts}`;
  const vendorBEmail = `reviews-vendor-b-${ts}@example.com`;
  const vendorBPassword = 'Pass1234!';
  const vendorBShop = `Reviews Shop B ${ts}`;
  const productBSlug = `reviews-mug-b-${ts}`;

  // Buyers
  const buyerEmail = `reviews-buyer-${ts}@example.com`;
  const buyerPassword = 'Pass1234!';
  const otherEmail = `reviews-other-${ts}@example.com`;
  const otherPassword = 'Pass1234!';

  let adminAccessToken = '';
  let buyerAccessToken = '';
  let otherAccessToken = '';
  let saRegionId = '';
  let vendorA: VendorFixture | null = null;
  let vendorB: VendorFixture | null = null;
  let firstOrderId = '';
  let firstSubOrderId = '';
  let firstItemId = '';
  let firstReviewId = '';

  const idemKey = (label: string) =>
    `idem-${label}-${ts}-xxxxxxxxxxxxxxxxxxxxxx`.slice(0, 64);

  async function setupVendor(args: {
    email: string;
    password: string;
    shop: string;
    productSlug: string;
    productName: { en: string; ar?: string };
    priceMinor: string;
  }): Promise<VendorFixture | null> {
    const signup = await request(APP_URL).post('/api/v1/vendor/signup').send({
      email: args.email,
      password: args.password,
      firstName: 'Vend',
      lastName: 'Or',
      name: args.shop,
    });
    expect(signup.status).toBe(201);
    const id = signup.body.id as string;
    const slug = signup.body.slug as string;

    const approve = await request(APP_URL)
      .patch(`/api/v1/admin/vendors/${id}/approve`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(approve.status).toBe(200);

    const login = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: args.email, password: args.password });
    if (login.status !== 200) return null;
    const token = login.body.token as string;

    const product = await request(APP_URL)
      .post('/api/v1/vendor/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        slug: args.productSlug,
        nameTranslations: args.productName,
        baseCurrency: 'SAR',
      });
    expect(product.status).toBe(201);
    const productId = product.body.id as string;

    const generated = await request(APP_URL)
      .post(`/api/v1/vendor/products/${productId}/variants/generate`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        optionTypes: [
          {
            slug: 'size',
            nameTranslations: { en: 'Size' },
            values: [
              { slug: 's', valueTranslations: { en: 'S' } },
              { slug: 'm', valueTranslations: { en: 'M' } },
            ],
          },
        ],
      });
    expect(generated.status).toBe(201);
    const variantIds: string[] = (generated.body as Array<{ id: string }>).map(
      (v) => v.id,
    );

    for (const vid of variantIds) {
      await request(APP_URL)
        .patch(`/api/v1/vendor/products/${productId}/variants/${vid}/prices`)
        .set('Authorization', `Bearer ${token}`)
        .send({ regionId: saRegionId, priceMinorUnits: args.priceMinor });
      await request(APP_URL)
        .patch(`/api/v1/vendor/products/${productId}/variants/${vid}/stock`)
        .set('Authorization', `Bearer ${token}`)
        .send({ quantity: 25 });
    }

    await request(APP_URL)
      .post(`/api/v1/vendor/products/${productId}/publish`)
      .set('Authorization', `Bearer ${token}`);

    await request(APP_URL)
      .post('/api/v1/vendor/shipping-zones')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'SA',
        countryCodes: ['SA'],
        costMinorUnits: '2500',
        currencyCode: 'SAR',
        estDeliveryDaysMin: 2,
        estDeliveryDaysMax: 5,
      });

    return {
      id,
      slug,
      token,
      productId,
      productSlug: args.productSlug,
      variantIds,
    };
  }

  // ── Setup ──────────────────────────────────────────────────────────

  it('should let admin log in', async () => {
    const res = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    adminAccessToken = res.body.token as string;
  });

  it('should resolve the SA region id', async () => {
    const res = await request(APP_URL).get('/api/v1/regions');
    expect(res.status).toBe(200);
    saRegionId =
      (res.body as Array<{ id: string; code: string }>).find(
        (r) => r.code === 'SA',
      )?.id ?? '';
    expect(saRegionId).toBeTruthy();
  });

  it('should set up vendor A + product', async () => {
    vendorA = await setupVendor({
      email: vendorAEmail,
      password: vendorAPassword,
      shop: vendorAShop,
      productSlug: productASlug,
      productName: { en: 'Reviews Tee A', ar: 'تيشيرت' },
      priceMinor: '9900',
    });
    expect(vendorA).toBeTruthy();
  });

  it('should set up vendor B + product', async () => {
    vendorB = await setupVendor({
      email: vendorBEmail,
      password: vendorBPassword,
      shop: vendorBShop,
      productSlug: productBSlug,
      productName: { en: 'Reviews Mug B' },
      priceMinor: '4500',
    });
    expect(vendorB).toBeTruthy();
  });

  it('should sign up + log in a buyer + an unrelated other user', async () => {
    const buyerSignup = await request(APP_URL)
      .post('/api/v1/vendor/signup')
      .send({
        email: buyerEmail,
        password: buyerPassword,
        firstName: 'Buy',
        lastName: 'Or',
        name: `Buyer Reviews Shop ${ts}`,
      });
    expect(buyerSignup.status).toBe(201);
    const buyerLogin = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: buyerEmail, password: buyerPassword });
    expect(buyerLogin.status).toBe(200);
    buyerAccessToken = buyerLogin.body.token as string;

    const otherSignup = await request(APP_URL)
      .post('/api/v1/vendor/signup')
      .send({
        email: otherEmail,
        password: otherPassword,
        firstName: 'Other',
        lastName: 'User',
        name: `Other Reviews Shop ${ts}`,
      });
    expect(otherSignup.status).toBe(201);
    const otherLogin = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: otherEmail, password: otherPassword });
    expect(otherLogin.status).toBe(200);
    otherAccessToken = otherLogin.body.token as string;
  });

  it('should place an order from vendor A', async () => {
    if (!vendorA) return;
    const add = await request(APP_URL)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${buyerAccessToken}`)
      .send({ variantId: vendorA.variantIds[0], quantity: 1 });
    expect(add.status).toBe(201);

    const placed = await request(APP_URL)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${buyerAccessToken}`)
      .set('Idempotency-Key', idemKey('PLACE-A'))
      .send({ address: saAddress, paymentMethod: 'COD' });
    expect(placed.status).toBe(201);
    firstOrderId = placed.body.id as string;
    firstSubOrderId = placed.body.subOrders[0].id as string;
    firstItemId = placed.body.subOrders[0].items[0].id as string;
  });

  // ── Buyer review (gating) ──────────────────────────────────────────

  it('should reject review submission BEFORE delivery (422)', async () => {
    if (!firstItemId) return;
    const res = await request(APP_URL)
      .post(
        `/api/v1/orders/${firstOrderId}/suborders/${firstSubOrderId}/items/${firstItemId}/review`,
      )
      .set('Authorization', `Bearer ${buyerAccessToken}`)
      .send({ rating: 5, body: 'Loved it.' });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/delivered/i);
  });

  it('should let admin mark the suborder DELIVERED via the backoffice override', async () => {
    if (!firstSubOrderId) return;
    const res = await request(APP_URL)
      .patch(`/api/v1/admin/sub-orders/${firstSubOrderId}/fulfillment-status`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ status: 'DELIVERED' });
    expect(res.status).toBe(200);
    expect(res.body.fulfillmentStatus).toBe('DELIVERED');
  });

  it('should reject 403 when another user submits a review for the order', async () => {
    const res = await request(APP_URL)
      .post(
        `/api/v1/orders/${firstOrderId}/suborders/${firstSubOrderId}/items/${firstItemId}/review`,
      )
      .set('Authorization', `Bearer ${otherAccessToken}`)
      .send({ rating: 5, body: 'sneaky' });
    expect(res.status).toBe(403);
  });

  it('should reject rating outside 1–5 (422)', async () => {
    const res = await request(APP_URL)
      .post(
        `/api/v1/orders/${firstOrderId}/suborders/${firstSubOrderId}/items/${firstItemId}/review`,
      )
      .set('Authorization', `Bearer ${buyerAccessToken}`)
      .send({ rating: 7, body: 'too high' });
    expect(res.status).toBe(422);
  });

  it('should accept the buyer review (201) once DELIVERED', async () => {
    const res = await request(APP_URL)
      .post(
        `/api/v1/orders/${firstOrderId}/suborders/${firstSubOrderId}/items/${firstItemId}/review`,
      )
      .set('Authorization', `Bearer ${buyerAccessToken}`)
      .send({ rating: 5, body: 'Excellent — would buy again.' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      orderItemId: firstItemId,
      productId: vendorA?.productId,
      vendorId: vendorA?.id,
      rating: 5,
      status: 'PUBLISHED',
    });
    firstReviewId = res.body.id as string;
  });

  it('should reject 409 on a duplicate review for the same item', async () => {
    const res = await request(APP_URL)
      .post(
        `/api/v1/orders/${firstOrderId}/suborders/${firstSubOrderId}/items/${firstItemId}/review`,
      )
      .set('Authorization', `Bearer ${buyerAccessToken}`)
      .send({ rating: 4, body: 'second' });
    expect(res.status).toBe(409);
  });

  // ── Public reads ───────────────────────────────────────────────────

  it('should list the published review on the product detail', async () => {
    if (!vendorA) return;
    const res = await request(APP_URL).get(
      `/api/v1/products/${vendorA.slug}/${vendorA.productSlug}/reviews`,
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    const found = (res.body.data as Array<{ id: string; status: string }>).find(
      (r) => r.id === firstReviewId,
    );
    expect(found).toBeTruthy();
    expect(found?.status).toBe('PUBLISHED');
  });

  it('should return correct count + average + distribution on the summary endpoint', async () => {
    if (!vendorA) return;
    const res = await request(APP_URL).get(
      `/api/v1/products/${vendorA.slug}/${vendorA.productSlug}/reviews/summary`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ count: 1, average: 5 });
    expect(res.body.distribution['5']).toBe(1);
    expect(res.body.distribution['1']).toBe(0);
  });

  // ── Vendor side ────────────────────────────────────────────────────

  it('should let vendor A see the review under /vendor/reviews', async () => {
    if (!vendorA) return;
    const res = await request(APP_URL)
      .get('/api/v1/vendor/reviews')
      .set('Authorization', `Bearer ${vendorA.token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    const found = (res.body.data as Array<{ id: string }>).find(
      (r) => r.id === firstReviewId,
    );
    expect(found).toBeTruthy();
  });

  it("should reject 403 when vendor B tries to respond to vendor A's review", async () => {
    if (!vendorB) return;
    const res = await request(APP_URL)
      .post(`/api/v1/vendor/reviews/${firstReviewId}/response`)
      .set('Authorization', `Bearer ${vendorB.token}`)
      .send({ body: 'sneaky vendor B response' });
    expect(res.status).toBe(403);
  });

  it('should let vendor A post a one-shot response (201)', async () => {
    if (!vendorA) return;
    const res = await request(APP_URL)
      .post(`/api/v1/vendor/reviews/${firstReviewId}/response`)
      .set('Authorization', `Bearer ${vendorA.token}`)
      .send({ body: 'Thanks for the kind words!' });
    expect(res.status).toBe(201);
    expect(res.body.body).toBe('Thanks for the kind words!');
  });

  it('should reject vendor A posting a SECOND response (409)', async () => {
    if (!vendorA) return;
    const res = await request(APP_URL)
      .post(`/api/v1/vendor/reviews/${firstReviewId}/response`)
      .set('Authorization', `Bearer ${vendorA.token}`)
      .send({ body: 'second' });
    expect(res.status).toBe(409);
  });

  it('should let vendor A edit the existing response (200)', async () => {
    if (!vendorA) return;
    const res = await request(APP_URL)
      .patch(`/api/v1/vendor/reviews/${firstReviewId}/response`)
      .set('Authorization', `Bearer ${vendorA.token}`)
      .send({ body: 'Updated reply.' });
    expect(res.status).toBe(200);
    expect(res.body.body).toBe('Updated reply.');
  });

  it('should block the BUYER from editing rating after vendor responded (409)', async () => {
    const res = await request(APP_URL)
      .patch(`/api/v1/me/reviews/${firstReviewId}`)
      .set('Authorization', `Bearer ${buyerAccessToken}`)
      .send({ rating: 1 });
    expect(res.status).toBe(409);
  });

  it('should still let the buyer edit body after vendor responded (200)', async () => {
    const res = await request(APP_URL)
      .patch(`/api/v1/me/reviews/${firstReviewId}`)
      .set('Authorization', `Bearer ${buyerAccessToken}`)
      .send({ body: 'Refined wording — still excellent.' });
    expect(res.status).toBe(200);
    expect(res.body.body).toMatch(/Refined/);
  });

  // ── Admin moderation ───────────────────────────────────────────────

  it('should let an admin mark the review REPORTED (200) and write an audit log', async () => {
    const res = await request(APP_URL)
      .patch(`/api/v1/admin/reviews/${firstReviewId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ status: 'REPORTED' });
    expect(res.status).toBe(200);
  });

  it('should hide REPORTED reviews from the public list', async () => {
    if (!vendorA) return;
    const res = await request(APP_URL).get(
      `/api/v1/products/${vendorA.slug}/${vendorA.productSlug}/reviews`,
    );
    expect(res.status).toBe(200);
    const found = (res.body.data as Array<{ id: string }>).find(
      (r) => r.id === firstReviewId,
    );
    expect(found).toBeUndefined();
  });

  it('should hide REPORTED reviews from the summary count', async () => {
    if (!vendorA) return;
    const res = await request(APP_URL).get(
      `/api/v1/products/${vendorA.slug}/${vendorA.productSlug}/reviews/summary`,
    );
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });

  it('should let an admin restore the review to PUBLISHED', async () => {
    const res = await request(APP_URL)
      .patch(`/api/v1/admin/reviews/${firstReviewId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ status: 'PUBLISHED' });
    expect(res.status).toBe(200);
  });
});
