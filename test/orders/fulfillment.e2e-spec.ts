import request from 'supertest';
import { ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL } from '../utils/constants';

describe('Fulfillment — vendor PATCH + buyer confirm-delivery (e2e)', () => {
  const ts = Date.now();
  // Vendor A
  const vendorAEmail = `fulfill-a-${ts}@example.com`;
  const vendorAPassword = 'Pass1234!';
  const vendorAShop = `Fulfill Shop A ${ts}`;
  const productASlug = `fulfill-tee-a-${ts}`;
  // Vendor B (multi-vendor partial-collected check)
  const vendorBEmail = `fulfill-b-${ts}@example.com`;
  const vendorBPassword = 'Pass1234!';
  const vendorBShop = `Fulfill Shop B ${ts}`;
  const productBSlug = `fulfill-mug-b-${ts}`;
  // Buyer
  const buyerEmail = `fulfill-buyer-${ts}@example.com`;
  const buyerPassword = 'Pass1234!';
  // A second buyer (ownership 403 check)
  const intruderEmail = `fulfill-intruder-${ts}@example.com`;
  const intruderPassword = 'Pass1234!';

  let adminAccessToken = '';
  let vendorAToken = '';
  let vendorBToken = '';
  let buyerAccessToken = '';
  let intruderAccessToken = '';
  let vendorAId = '';
  let vendorBId = '';
  let saRegionId = '';
  const variantAIds: string[] = [];
  const variantBIds: string[] = [];

  let placedOrderId = '';
  let vendorASubOrderId = '';
  let vendorBSubOrderId = '';

  const idemKey = `idem-fulfill-${ts}-xxxxxxxxxxxxxxxx`.slice(0, 64);

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

  async function setupVendor(
    email: string,
    password: string,
    shop: string,
    productSlug: string,
    productName: { en: string },
    priceMinor: string,
  ): Promise<{ vendorId: string; vendorToken: string; variantIds: string[] }> {
    const signup = await request(APP_URL).post('/api/v1/vendor/signup').send({
      email,
      password,
      firstName: 'Vend',
      lastName: 'Or',
      name: shop,
    });
    expect(signup.status).toBe(201);
    const vendorId = signup.body.id as string;

    await request(APP_URL)
      .patch(`/api/v1/admin/vendors/${vendorId}/approve`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    const login = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email, password });
    const vendorToken = login.body.token as string;

    const product = await request(APP_URL)
      .post('/api/v1/vendor/products')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        slug: productSlug,
        nameTranslations: productName,
        baseCurrency: 'SAR',
      });
    const productId = product.body.id as string;

    const generated = await request(APP_URL)
      .post(`/api/v1/vendor/products/${productId}/variants/generate`)
      .set('Authorization', `Bearer ${vendorToken}`)
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
    const variantIds: string[] = (generated.body as Array<{ id: string }>).map(
      (v) => v.id,
    );

    for (const vid of variantIds) {
      await request(APP_URL)
        .patch(`/api/v1/vendor/products/${productId}/variants/${vid}/prices`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ regionId: saRegionId, priceMinorUnits: priceMinor });
      await request(APP_URL)
        .patch(`/api/v1/vendor/products/${productId}/variants/${vid}/stock`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ quantity: 25 });
    }

    await request(APP_URL)
      .post(`/api/v1/vendor/products/${productId}/publish`)
      .set('Authorization', `Bearer ${vendorToken}`);

    await request(APP_URL)
      .post('/api/v1/vendor/shipping-zones')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        name: 'SA',
        countryCodes: ['SA'],
        costMinorUnits: '2500',
        currencyCode: 'SAR',
        estDeliveryDaysMin: 2,
        estDeliveryDaysMax: 5,
      });

    return { vendorId, vendorToken, variantIds };
  }

  it('should set up admin, regions, vendors, buyer and intruder', async () => {
    const adminLogin = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    adminAccessToken = adminLogin.body.token as string;
    expect(adminAccessToken).toBeTruthy();

    const regions = await request(APP_URL).get('/api/v1/regions');
    saRegionId =
      (regions.body as Array<{ id: string; code: string }>).find(
        (r) => r.code === 'SA',
      )?.id ?? '';
    expect(saRegionId).toBeTruthy();

    const a = await setupVendor(
      vendorAEmail,
      vendorAPassword,
      vendorAShop,
      productASlug,
      { en: 'Fulfill Tee A' },
      '9900',
    );
    vendorAId = a.vendorId;
    vendorAToken = a.vendorToken;
    variantAIds.push(...a.variantIds);

    const b = await setupVendor(
      vendorBEmail,
      vendorBPassword,
      vendorBShop,
      productBSlug,
      { en: 'Fulfill Mug B' },
      '4500',
    );
    vendorBId = b.vendorId;
    vendorBToken = b.vendorToken;
    variantBIds.push(...b.variantIds);

    // Buyer (uses vendor signup since that's how buyers get accounts in this codebase)
    await request(APP_URL)
      .post('/api/v1/vendor/signup')
      .send({
        email: buyerEmail,
        password: buyerPassword,
        firstName: 'Buy',
        lastName: 'Er',
        name: `Fulfill Buyer Shop ${ts}`,
      });
    const buyerLogin = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: buyerEmail, password: buyerPassword });
    buyerAccessToken = buyerLogin.body.token as string;

    // Intruder
    await request(APP_URL)
      .post('/api/v1/vendor/signup')
      .send({
        email: intruderEmail,
        password: intruderPassword,
        firstName: 'In',
        lastName: 'Truder',
        name: `Fulfill Intruder Shop ${ts}`,
      });
    const intruderLogin = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: intruderEmail, password: intruderPassword });
    intruderAccessToken = intruderLogin.body.token as string;
  }, 30_000);

  it('should place a multi-vendor order (1 Order, 2 SubOrders)', async () => {
    await request(APP_URL)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${buyerAccessToken}`)
      .send({ variantId: variantAIds[0], quantity: 2 });
    await request(APP_URL)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${buyerAccessToken}`)
      .send({ variantId: variantBIds[0], quantity: 1 });

    const placed = await request(APP_URL)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${buyerAccessToken}`)
      .set('Idempotency-Key', idemKey)
      .send({ address: saAddress, paymentMethod: 'COD' });
    expect(placed.status).toBe(201);
    expect(placed.body.subOrders).toHaveLength(2);
    placedOrderId = placed.body.id as string;
    const subs = placed.body.subOrders as Array<{
      id: string;
      vendorId: string;
    }>;
    vendorASubOrderId = subs.find((s) => s.vendorId === vendorAId)!.id;
    vendorBSubOrderId = subs.find((s) => s.vendorId === vendorBId)!.id;
    expect(placed.body.paymentStatus).toBe('PENDING');
  });

  // ── Vendor PATCH lifecycle ─────────────────────────────────────────

  it('should let vendor A move AWAITING_CONFIRMATION → CONFIRMED', async () => {
    const res = await request(APP_URL)
      .patch(`/api/v1/vendor/suborders/${vendorASubOrderId}/status`)
      .set('Authorization', `Bearer ${vendorAToken}`)
      .send({ status: 'CONFIRMED' });
    expect(res.status).toBe(200);
    expect(res.body.fulfillmentStatus).toBe('CONFIRMED');
  });

  it('should reject backward jump CONFIRMED → AWAITING_CONFIRMATION (422)', async () => {
    const res = await request(APP_URL)
      .patch(`/api/v1/vendor/suborders/${vendorASubOrderId}/status`)
      .set('Authorization', `Bearer ${vendorAToken}`)
      .send({ status: 'AWAITING_CONFIRMATION' });
    // The DTO restricts the enum, so the validator catches it as 422.
    expect(res.status).toBe(422);
  });

  it('should reject skipping CONFIRMED → SHIPPED (422 from state machine)', async () => {
    const res = await request(APP_URL)
      .patch(`/api/v1/vendor/suborders/${vendorASubOrderId}/status`)
      .set('Authorization', `Bearer ${vendorAToken}`)
      .send({ status: 'SHIPPED', trackingNumber: 'TRK-XYZ' });
    expect(res.status).toBe(422);
  });

  it('should let vendor A move CONFIRMED → PACKED and set packed_at', async () => {
    const res = await request(APP_URL)
      .patch(`/api/v1/vendor/suborders/${vendorASubOrderId}/status`)
      .set('Authorization', `Bearer ${vendorAToken}`)
      .send({ status: 'PACKED' });
    expect(res.status).toBe(200);
    expect(res.body.fulfillmentStatus).toBe('PACKED');
    expect(res.body.packedAt).toBeTruthy();
  });

  it('should reject SHIPPED without tracking_number (422)', async () => {
    const res = await request(APP_URL)
      .patch(`/api/v1/vendor/suborders/${vendorASubOrderId}/status`)
      .set('Authorization', `Bearer ${vendorAToken}`)
      .send({ status: 'SHIPPED' });
    expect(res.status).toBe(422);
  });

  it('should let vendor A move PACKED → SHIPPED with tracking_number + courier', async () => {
    const res = await request(APP_URL)
      .patch(`/api/v1/vendor/suborders/${vendorASubOrderId}/status`)
      .set('Authorization', `Bearer ${vendorAToken}`)
      .send({
        status: 'SHIPPED',
        trackingNumber: 'ARX-998877',
        courierName: 'Aramex',
      });
    expect(res.status).toBe(200);
    expect(res.body.fulfillmentStatus).toBe('SHIPPED');
    expect(res.body.trackingNumber).toBe('ARX-998877');
    expect(res.body.courierName).toBe('Aramex');
    expect(res.body.shippedAt).toBeTruthy();
  });

  it("should 404 when vendor B PATCHes vendor A's SubOrder (no leak)", async () => {
    const res = await request(APP_URL)
      .patch(`/api/v1/vendor/suborders/${vendorASubOrderId}/status`)
      .set('Authorization', `Bearer ${vendorBToken}`)
      .send({ status: 'CONFIRMED' });
    expect(res.status).toBe(404);
  });

  it('should reject PATCH without auth (401)', async () => {
    const res = await request(APP_URL)
      .patch(`/api/v1/vendor/suborders/${vendorASubOrderId}/status`)
      .send({ status: 'CONFIRMED' });
    expect(res.status).toBe(401);
  });

  // ── Buyer confirm-delivery ─────────────────────────────────────────

  it('should reject confirm-delivery while SubOrder is still AWAITING (422)', async () => {
    const res = await request(APP_URL)
      .post(
        `/api/v1/orders/${placedOrderId}/suborders/${vendorBSubOrderId}/confirm-delivery`,
      )
      .set('Authorization', `Bearer ${buyerAccessToken}`);
    expect(res.status).toBe(422);
  });

  it('should 403 when an intruder tries to confirm delivery on the order', async () => {
    const res = await request(APP_URL)
      .post(
        `/api/v1/orders/${placedOrderId}/suborders/${vendorASubOrderId}/confirm-delivery`,
      )
      .set('Authorization', `Bearer ${intruderAccessToken}`);
    expect(res.status).toBe(403);
  });

  it('should let buyer confirm-delivery on vendor A SubOrder → DELIVERED', async () => {
    const res = await request(APP_URL)
      .post(
        `/api/v1/orders/${placedOrderId}/suborders/${vendorASubOrderId}/confirm-delivery`,
      )
      .set('Authorization', `Bearer ${buyerAccessToken}`);
    expect(res.status).toBe(201);
    expect(res.body.fulfillmentStatus).toBe('DELIVERED');
    expect(res.body.deliveredAt).toBeTruthy();
  });

  it('should leave parent Order.payment_status as PARTIAL after one of two SubOrders delivered', async () => {
    const res = await request(APP_URL)
      .get(`/api/v1/orders/${placedOrderId}`)
      .set('Authorization', `Bearer ${buyerAccessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.paymentStatus).toBe('PARTIAL');
  });

  it('should drive vendor B SubOrder to SHIPPED, then let buyer confirm delivery', async () => {
    for (const next of ['CONFIRMED', 'PACKED']) {
      const r = await request(APP_URL)
        .patch(`/api/v1/vendor/suborders/${vendorBSubOrderId}/status`)
        .set('Authorization', `Bearer ${vendorBToken}`)
        .send({ status: next });
      expect(r.status).toBe(200);
    }
    const ship = await request(APP_URL)
      .patch(`/api/v1/vendor/suborders/${vendorBSubOrderId}/status`)
      .set('Authorization', `Bearer ${vendorBToken}`)
      .send({ status: 'SHIPPED', trackingNumber: 'ARX-B-77' });
    expect(ship.status).toBe(200);

    const confirm = await request(APP_URL)
      .post(
        `/api/v1/orders/${placedOrderId}/suborders/${vendorBSubOrderId}/confirm-delivery`,
      )
      .set('Authorization', `Bearer ${buyerAccessToken}`);
    expect(confirm.status).toBe(201);
  });

  it('should flip parent Order.payment_status to COLLECTED once all SubOrders delivered', async () => {
    const res = await request(APP_URL)
      .get(`/api/v1/orders/${placedOrderId}`)
      .set('Authorization', `Bearer ${buyerAccessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.paymentStatus).toBe('COLLECTED');
  });

  it('should reject re-confirming an already-DELIVERED SubOrder (422)', async () => {
    const res = await request(APP_URL)
      .post(
        `/api/v1/orders/${placedOrderId}/suborders/${vendorASubOrderId}/confirm-delivery`,
      )
      .set('Authorization', `Bearer ${buyerAccessToken}`);
    expect(res.status).toBe(422);
  });

  // ── OrderEvent timeline ────────────────────────────────────────────

  it('should let buyer GET vendor A timeline (oldest-first, all events present)', async () => {
    const res = await request(APP_URL)
      .get(
        `/api/v1/orders/${placedOrderId}/suborders/${vendorASubOrderId}/events`,
      )
      .set('Authorization', `Bearer ${buyerAccessToken}`);
    expect(res.status).toBe(200);
    const events = res.body.data as Array<{
      eventType: string;
      fromStatus: string | null;
      toStatus: string | null;
      createdAt: string;
    }>;
    // 3 STATUS_CHANGED (CONFIRMED, PACKED, SHIPPED) + 1 STATUS_CHANGED (DELIVERED)
    // + 1 DELIVERED_BY_BUYER + 1 PAYMENT_COLLECTED = 6
    expect(events.length).toBeGreaterThanOrEqual(6);
    // Oldest first.
    const types = events.map((e) => e.eventType);
    // First 4 are STATUS_CHANGED, then DELIVERED_BY_BUYER + PAYMENT_COLLECTED
    expect(types[0]).toBe('STATUS_CHANGED');
    expect(events[0].toStatus).toBe('CONFIRMED');
    expect(events[1].toStatus).toBe('PACKED');
    expect(events[2].toStatus).toBe('SHIPPED');
    expect(events[3].toStatus).toBe('DELIVERED');
    expect(types).toContain('DELIVERED_BY_BUYER');
    expect(types).toContain('PAYMENT_COLLECTED');
    // Sorted ASC by createdAt.
    for (let i = 1; i < events.length; i++) {
      expect(new Date(events[i].createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(events[i - 1].createdAt).getTime(),
      );
    }
  });

  it('should let the owning vendor (A) GET its own timeline', async () => {
    const res = await request(APP_URL)
      .get(
        `/api/v1/orders/${placedOrderId}/suborders/${vendorASubOrderId}/events`,
      )
      .set('Authorization', `Bearer ${vendorAToken}`);
    expect(res.status).toBe(200);
    expect((res.body.data as unknown[]).length).toBeGreaterThanOrEqual(6);
  });

  it("should 404 when vendor B reads vendor A's timeline", async () => {
    const res = await request(APP_URL)
      .get(
        `/api/v1/orders/${placedOrderId}/suborders/${vendorASubOrderId}/events`,
      )
      .set('Authorization', `Bearer ${vendorBToken}`);
    expect(res.status).toBe(404);
  });

  it('should 404 when an intruder buyer tries to read events', async () => {
    const res = await request(APP_URL)
      .get(
        `/api/v1/orders/${placedOrderId}/suborders/${vendorASubOrderId}/events`,
      )
      .set('Authorization', `Bearer ${intruderAccessToken}`);
    expect(res.status).toBe(404);
  });
});
