import request from 'supertest';
import { ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL } from '../utils/constants';
import { approveVendorFully } from '../utils/payouts-fixtures';

describe('Returns / RMA (e2e)', () => {
  const ts = Date.now();
  const vendorEmail = `rma-vendor-${ts}@example.com`;
  const vendorPassword = 'Pass1234!';
  const buyerEmail = `rma-buyer-${ts}@example.com`;
  const buyerPassword = 'Pass1234!';
  const shopName = `RMA Shop ${ts}`;
  const productSlug = `rma-tee-${ts}`;

  let adminToken = '';
  let vendorToken = '';
  let buyerToken = '';
  let vendorId = '';
  let variantId = '';
  let orderId = '';
  let subOrderId = '';
  let orderItemId = '';
  let returnId = '';

  const saAddress = {
    fullName: 'RMA Buyer',
    phone: '+966555077777',
    country: 'SA',
    region: 'Riyadh',
    city: 'Riyadh',
    postalCode: '12345',
    street: 'Test st 7',
    notes: null,
  };

  const validKey = (label: string) =>
    `idem-${label}-${ts}-xxxxxxxxxxxxx`.slice(0, 64);

  beforeAll(async () => {
    // 1. Admin login.
    const adminLogin = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    adminToken = adminLogin.body.token as string;

    // 2. Vendor signup + approve + login.
    const vendorSignup = await request(APP_URL)
      .post('/api/v1/vendor/signup')
      .send({
        email: vendorEmail,
        password: vendorPassword,
        firstName: 'RMA',
        lastName: 'Vendor',
        name: shopName,
      });
    vendorId = vendorSignup.body.id as string;

    // Login once (PENDING status) so approveVendorFully can upload KYC docs.
    const pendingLogin = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: vendorEmail, password: vendorPassword });
    const pendingVendorToken = pendingLogin.body.token as string;

    await approveVendorFully(adminToken, pendingVendorToken, vendorId);

    // Re-login to obtain a fresh token reflecting ACTIVE status.
    const vendorLogin = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: vendorEmail, password: vendorPassword });
    vendorToken = vendorLogin.body.token as string;

    // 3. Resolve SA region.
    const regions = await request(APP_URL).get('/api/v1/regions');
    const saRegion = (regions.body as Array<{ id: string; code: string }>).find(
      (r) => r.code === 'SA',
    );
    const saRegionId = saRegion!.id;

    // 4. Product + single variant (no option types) + price + stock + publish.
    const product = await request(APP_URL)
      .post('/api/v1/vendor/products')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        slug: productSlug,
        nameTranslations: { en: 'RMA Tee', ar: 'تي شيرت' },
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
            values: [{ slug: 'one', valueTranslations: { en: 'One' } }],
          },
        ],
      });
    variantId = (generated.body as Array<{ id: string }>)[0].id;

    await request(APP_URL)
      .patch(
        `/api/v1/vendor/products/${productId}/variants/${variantId}/prices`,
      )
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ regionId: saRegionId, priceMinorUnits: '5000' });

    await request(APP_URL)
      .patch(`/api/v1/vendor/products/${productId}/variants/${variantId}/stock`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ quantity: 50 });

    await request(APP_URL)
      .post(`/api/v1/vendor/products/${productId}/publish`)
      .set('Authorization', `Bearer ${vendorToken}`);

    await request(APP_URL)
      .post('/api/v1/vendor/shipping-zones')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        name: 'SA standard',
        countryCodes: ['SA'],
        costMinorUnits: '0',
        currencyCode: 'SAR',
        estDeliveryDaysMin: 1,
        estDeliveryDaysMax: 3,
      });

    // 5. Buyer signup (uses vendor signup since that's how buyer accounts are
    //    created in this codebase) + login.
    await request(APP_URL)
      .post('/api/v1/vendor/signup')
      .send({
        email: buyerEmail,
        password: buyerPassword,
        firstName: 'RMA',
        lastName: 'Buyer',
        name: `RMA Buyer Shop ${ts}`,
      });

    const buyerLogin = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: buyerEmail, password: buyerPassword });
    buyerToken = buyerLogin.body.token as string;

    // 6. Buyer adds 2 units to cart and places a COD order.
    await request(APP_URL)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ variantId, quantity: 2 });

    const place = await request(APP_URL)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Idempotency-Key', validKey('place'))
      .send({ address: saAddress, paymentMethod: 'COD' });
    orderId = place.body.id as string;
    subOrderId = place.body.subOrders[0].id as string;
    orderItemId = place.body.subOrders[0].items[0].id as string;

    // 7. Drive the sub-order through CONFIRMED → PACKED → SHIPPED. SHIPPED
    //    requires a tracking number per the fulfillment DTO.
    await request(APP_URL)
      .patch(`/api/v1/vendor/suborders/${subOrderId}/status`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: 'CONFIRMED' });
    await request(APP_URL)
      .patch(`/api/v1/vendor/suborders/${subOrderId}/status`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: 'PACKED' });
    await request(APP_URL)
      .patch(`/api/v1/vendor/suborders/${subOrderId}/status`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        status: 'SHIPPED',
        trackingNumber: 'TRK-OUT-1',
        courierName: 'Aramex',
      });

    // 8. Buyer confirms delivery → sub-order = DELIVERED.
    await request(APP_URL)
      .post(
        `/api/v1/orders/${orderId}/suborders/${subOrderId}/confirm-delivery`,
      )
      .set('Authorization', `Bearer ${buyerToken}`);
  }, 120000);

  it('should walk through the full RMA happy path with auto-flip to RETURNED', async () => {
    // 1. Buyer creates an RMA for both ordered units.
    const create = await request(APP_URL)
      .post(`/api/v1/orders/${orderId}/suborders/${subOrderId}/returns`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        items: [{ orderItemId, quantity: 2 }],
        reason: 'DAMAGED',
        reasonNote: 'Both arrived damaged.',
      });
    expect(create.status).toBe(201);
    expect(create.body.status).toBe('REQUESTED');
    returnId = create.body.id as string;

    // 2. Vendor approves.
    const approve = await request(APP_URL)
      .patch(`/api/v1/vendor/returns/${returnId}`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: 'APPROVED' });
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe('APPROVED');

    // 3. Buyer ships back with tracking.
    const ship = await request(APP_URL)
      .patch(`/api/v1/returns/${returnId}/shipped-back`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ trackingNumber: 'TRK-XYZ-1' });
    expect(ship.status).toBe(200);
    expect(ship.body.status).toBe('SHIPPED_BACK');
    expect(ship.body.returnTrackingNumber).toBe('TRK-XYZ-1');

    // 4. Vendor confirms RECEIVED with restock.
    const recv = await request(APP_URL)
      .patch(`/api/v1/vendor/returns/${returnId}`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: 'RECEIVED', restock: true });
    expect(recv.status).toBe(200);
    expect(recv.body.status).toBe('RECEIVED');
    expect(recv.body.restocked).toBe(true);

    // 5. Vendor marks REFUNDED.
    const refund = await request(APP_URL)
      .patch(`/api/v1/vendor/returns/${returnId}`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: 'REFUNDED' });
    expect(refund.status).toBe(200);
    expect(refund.body.status).toBe('REFUNDED');

    // 6. Vendor closes.
    const close = await request(APP_URL)
      .patch(`/api/v1/vendor/returns/${returnId}`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: 'CLOSED' });
    expect(close.status).toBe(200);
    expect(close.body.status).toBe('CLOSED');

    // 7. Sub-order should auto-flip to RETURNED.
    const order = await request(APP_URL)
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(order.status).toBe(200);
    const so = (
      order.body.subOrders as Array<{ id: string; fulfillmentStatus: string }>
    ).find((s) => s.id === subOrderId);
    expect(so?.fulfillmentStatus).toBe('RETURNED');
  }, 60000);

  it('should reject a return on a sub-order that is not DELIVERED', async () => {
    // Register a second buyer, place a COD order, but DO NOT drive the sub-order
    // through fulfillment — it stays at AWAITING_CONFIRMATION.
    const buyer2Email = `rma-buyer2-${ts}@example.com`;
    const buyer2Password = 'Pass1234!';
    await request(APP_URL).post('/api/v1/auth/email/register').send({
      email: buyer2Email,
      password: buyer2Password,
      firstName: 'Buyer2',
      lastName: 'Test',
    });
    const login = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: buyer2Email, password: buyer2Password });
    const tok = login.body.token as string;
    await request(APP_URL)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${tok}`)
      .send({ variantId, quantity: 1 });
    const place = await request(APP_URL)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', validKey('place2'))
      .send({ address: saAddress, paymentMethod: 'COD' });
    const oid2 = place.body.id as string;
    const sid2 = place.body.subOrders[0].id as string;
    const oii2 = place.body.subOrders[0].items[0].id as string;

    const res = await request(APP_URL)
      .post(`/api/v1/orders/${oid2}/suborders/${sid2}/returns`)
      .set('Authorization', `Bearer ${tok}`)
      .send({
        items: [{ orderItemId: oii2, quantity: 1 }],
        reason: 'DAMAGED',
      });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/DELIVERED/i);
  }, 60000);

  it('should reject reason=OTHER without reasonNote', async () => {
    // Fresh order, drive to DELIVERED, then try to open RMA with reason=OTHER
    // and no reasonNote.
    await request(APP_URL)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ variantId, quantity: 1 });
    const place = await request(APP_URL)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Idempotency-Key', validKey('other'))
      .send({ address: saAddress, paymentMethod: 'COD' });
    const oid3 = place.body.id as string;
    const sid3 = place.body.subOrders[0].id as string;
    const oii3 = place.body.subOrders[0].items[0].id as string;
    await request(APP_URL)
      .patch(`/api/v1/vendor/suborders/${sid3}/status`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: 'CONFIRMED' });
    await request(APP_URL)
      .patch(`/api/v1/vendor/suborders/${sid3}/status`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: 'PACKED' });
    await request(APP_URL)
      .patch(`/api/v1/vendor/suborders/${sid3}/status`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        status: 'SHIPPED',
        trackingNumber: 'TRK-OUT-OTHER',
        courierName: 'Aramex',
      });
    await request(APP_URL)
      .post(`/api/v1/orders/${oid3}/suborders/${sid3}/confirm-delivery`)
      .set('Authorization', `Bearer ${buyerToken}`);

    const res = await request(APP_URL)
      .post(`/api/v1/orders/${oid3}/suborders/${sid3}/returns`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ items: [{ orderItemId: oii3, quantity: 1 }], reason: 'OTHER' });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/reasonNote/i);
  }, 60000);

  it('should reject quantity > ordered', async () => {
    // Fresh order with quantity 1, then try to open RMA with quantity 99.
    await request(APP_URL)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ variantId, quantity: 1 });
    const place = await request(APP_URL)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Idempotency-Key', validKey('big'))
      .send({ address: saAddress, paymentMethod: 'COD' });
    const oid4 = place.body.id as string;
    const sid4 = place.body.subOrders[0].id as string;
    const oii4 = place.body.subOrders[0].items[0].id as string;
    await request(APP_URL)
      .patch(`/api/v1/vendor/suborders/${sid4}/status`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: 'CONFIRMED' });
    await request(APP_URL)
      .patch(`/api/v1/vendor/suborders/${sid4}/status`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: 'PACKED' });
    await request(APP_URL)
      .patch(`/api/v1/vendor/suborders/${sid4}/status`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        status: 'SHIPPED',
        trackingNumber: 'TRK-OUT-BIG',
        courierName: 'Aramex',
      });
    await request(APP_URL)
      .post(`/api/v1/orders/${oid4}/suborders/${sid4}/confirm-delivery`)
      .set('Authorization', `Bearer ${buyerToken}`);

    const res = await request(APP_URL)
      .post(`/api/v1/orders/${oid4}/suborders/${sid4}/returns`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        items: [{ orderItemId: oii4, quantity: 99 }],
        reason: 'DAMAGED',
      });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/quantity/i);
  }, 60000);

  it('should return 404 when another buyer reads the RMA', async () => {
    const otherEmail = `rma-other-${ts}@example.com`;
    const otherPassword = 'Pass1234!';
    await request(APP_URL).post('/api/v1/auth/email/register').send({
      email: otherEmail,
      password: otherPassword,
      firstName: 'Other',
      lastName: 'Buyer',
    });
    const oLogin = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: otherEmail, password: otherPassword });
    const otherTok = oLogin.body.token as string;
    const res = await request(APP_URL)
      .get(`/api/v1/returns/${returnId}`)
      .set('Authorization', `Bearer ${otherTok}`);
    expect(res.status).toBe(404);
  }, 60000);

  it('should reject vendor PATCH from a different vendor (404)', async () => {
    // Open a fresh RMA via the original buyer + vendor 1 and leave it at REQUESTED.
    await request(APP_URL)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ variantId, quantity: 1 });
    const place = await request(APP_URL)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Idempotency-Key', validKey('v2'))
      .send({ address: saAddress, paymentMethod: 'COD' });
    const oid = place.body.id as string;
    const sid = place.body.subOrders[0].id as string;
    const oii = place.body.subOrders[0].items[0].id as string;
    await request(APP_URL)
      .patch(`/api/v1/vendor/suborders/${sid}/status`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: 'CONFIRMED' });
    await request(APP_URL)
      .patch(`/api/v1/vendor/suborders/${sid}/status`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: 'PACKED' });
    await request(APP_URL)
      .patch(`/api/v1/vendor/suborders/${sid}/status`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        status: 'SHIPPED',
        trackingNumber: 'TRK-OUT-V2',
        courierName: 'Aramex',
      });
    await request(APP_URL)
      .post(`/api/v1/orders/${oid}/suborders/${sid}/confirm-delivery`)
      .set('Authorization', `Bearer ${buyerToken}`);
    const open = await request(APP_URL)
      .post(`/api/v1/orders/${oid}/suborders/${sid}/returns`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        items: [{ orderItemId: oii, quantity: 1 }],
        reason: 'WRONG_ITEM',
      });
    expect(open.status).toBe(201);
    const newReturnId = open.body.id as string;

    // Sign up vendor 2 (use `name`, not `shopName`).
    const v2Email = `rma-vendor2-${ts}@example.com`;
    const v2Signup = await request(APP_URL)
      .post('/api/v1/vendor/signup')
      .send({
        email: v2Email,
        password: 'Pass1234!',
        firstName: 'Vendor',
        lastName: 'Two',
        name: `RMA Shop 2 ${ts}`,
      });
    const v2VendorId = v2Signup.body.id as string;
    // Need to obtain a token while still PENDING so approveVendorFully can
    // upload KYC docs, then re-login after activation.
    const v2PendingLogin = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: v2Email, password: 'Pass1234!' });
    const v2PendingToken = v2PendingLogin.body.token as string;
    await approveVendorFully(adminToken, v2PendingToken, v2VendorId);
    const v2Login = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: v2Email, password: 'Pass1234!' });
    const v2Token = v2Login.body.token as string;

    // Vendor 2 tries to approve vendor 1's RMA — must 404 (no existence leak).
    const res = await request(APP_URL)
      .patch(`/api/v1/vendor/returns/${newReturnId}`)
      .set('Authorization', `Bearer ${v2Token}`)
      .send({ status: 'APPROVED' });
    expect(res.status).toBe(404);
  }, 60000);
});
