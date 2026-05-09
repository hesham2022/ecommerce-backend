import request from 'supertest';
import { ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL } from '../utils/constants';

describe('Chat (e2e)', () => {
  const ts = Date.now();
  const vendorEmail = `chat-vendor-${ts}@example.com`;
  const vendorPassword = 'Pass1234!';
  const vendorShop = `Chat Shop ${ts}`;
  const buyerEmail = `chat-buyer-${ts}@example.com`;
  const buyerPassword = 'Pass1234!';
  const otherEmail = `chat-other-${ts}@example.com`;
  const otherPassword = 'Pass1234!';
  const productSlug = `chat-tee-${ts}`;

  let adminToken = '';
  let vendorToken = '';
  let buyerToken = '';
  let otherToken = '';
  let vendorId = '';
  let buyerUserId = 0;
  let vendorUserId = 0;
  let otherUserId = 0;
  let saRegionId = '';
  let conversationId = ''; // DIRECT conversation
  let orderConversationId = ''; // ORDER conversation
  let placedSubOrderId = '';
  let spamVendorId = '';
  let spamConversationId = '';

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

  it('should admin login', async () => {
    const res = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    adminToken = res.body.token as string;
  });

  it('should resolve SA region', async () => {
    const res = await request(APP_URL).get('/api/v1/regions');
    expect(res.status).toBe(200);
    saRegionId =
      (res.body as Array<{ id: string; code: string }>).find(
        (r) => r.code === 'SA',
      )?.id ?? '';
    expect(saRegionId).toBeTruthy();
  });

  it('should vendor signup, approve, login', async () => {
    const signup = await request(APP_URL).post('/api/v1/vendor/signup').send({
      email: vendorEmail,
      password: vendorPassword,
      firstName: 'Vend',
      lastName: 'Or',
      name: vendorShop,
    });
    expect(signup.status).toBe(201);
    vendorId = signup.body.id as string;

    const approve = await request(APP_URL)
      .patch(`/api/v1/admin/vendors/${vendorId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(approve.status).toBe(200);

    const login = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: vendorEmail, password: vendorPassword });
    expect(login.status).toBe(200);
    vendorToken = login.body.token as string;
    vendorUserId = login.body.user.id as number;
  });

  it('should buyer + other user signup', async () => {
    const buyer = await request(APP_URL)
      .post('/api/v1/vendor/signup')
      .send({
        email: buyerEmail,
        password: buyerPassword,
        firstName: 'Buy',
        lastName: 'Or',
        name: `Buyer Shop ${ts}`,
      });
    expect(buyer.status).toBe(201);
    const buyerLogin = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: buyerEmail, password: buyerPassword });
    expect(buyerLogin.status).toBe(200);
    buyerToken = buyerLogin.body.token as string;
    buyerUserId = buyerLogin.body.user.id as number;

    const other = await request(APP_URL)
      .post('/api/v1/vendor/signup')
      .send({
        email: otherEmail,
        password: otherPassword,
        firstName: 'Oth',
        lastName: 'Er',
        name: `Other Shop ${ts}`,
      });
    expect(other.status).toBe(201);
    const otherLogin = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: otherEmail, password: otherPassword });
    expect(otherLogin.status).toBe(200);
    otherToken = otherLogin.body.token as string;
    otherUserId = otherLogin.body.user.id as number;
  });

  it('should register, upsert, and delete FCM tokens under /me', async () => {
    const token = `fcm-${ts}`;
    const first = await request(APP_URL)
      .post('/api/v1/me/fcm-tokens')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ token, platform: 'ios', deviceId: 'ios-1' });
    expect(first.status).toBe(201);
    expect(first.body.token).toBe(token);

    const duplicate = await request(APP_URL)
      .post('/api/v1/me/fcm-tokens')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ token, platform: 'android', deviceId: 'android-1' });
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.id).toBe(first.body.id);
    expect(duplicate.body.platform).toBe('android');

    const removed = await request(APP_URL)
      .delete(`/api/v1/me/fcm-tokens/${encodeURIComponent(token)}`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(removed.status).toBe(204);
  });

  it('should enforce 100MB/day quota for confirmed chat attachments', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const presign = await request(APP_URL)
        .post('/api/v1/files/presign')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          fileName: `quota-${i}.jpg`,
          fileSize: 20 * 1024 * 1024,
          mimeType: 'image/jpeg',
          purpose: 'chat-attachment',
        });
      expect(presign.status).toBe(201);
      ids.push(presign.body.fileId as string);
    }

    for (const id of ids.slice(0, 5)) {
      const confirm = await request(APP_URL)
        .post(`/api/v1/files/${id}/confirm`)
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(confirm.status).toBe(201);
    }

    const rejected = await request(APP_URL)
      .post(`/api/v1/files/${ids[5]}/confirm`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(rejected.status).toBe(422);
    expect(JSON.stringify(rejected.body)).toContain(
      'attachment_quota_exceeded',
    );
  });

  // ── DIRECT conversation idempotent create ────────────────────────────

  it('should buyer creates a DIRECT conversation, then re-creates → same id', async () => {
    const first = await request(APP_URL)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ kind: 'DIRECT', vendorId });
    expect(first.status).toBe(201);
    expect(first.body.kind).toBe('DIRECT');
    expect(first.body.vendorId).toBe(vendorId);
    expect(first.body.buyerId).toBe(buyerUserId);
    expect(first.body.subOrderId).toBeNull();
    conversationId = first.body.id as string;

    const second = await request(APP_URL)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ kind: 'DIRECT', vendorId });
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(conversationId);
  });

  it('should vendor cannot initiate DIRECT to a buyer', async () => {
    // Vendor would point at their own vendor id — owner check kicks in.
    const res = await request(APP_URL)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ kind: 'DIRECT', vendorId });
    expect(res.status).toBe(403);
  });

  // ── Send + read + paginate ───────────────────────────────────────────

  it('should buyer sends a message, vendor lists & reads it', async () => {
    const send = await request(APP_URL)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ body: 'Hello vendor!' });
    expect(send.status).toBe(201);
    expect(send.body.body).toBe('Hello vendor!');
    expect(send.body.senderUserId).toBe(buyerUserId);

    // GET messages as the vendor.
    const list = await request(APP_URL)
      .get(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${vendorToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(1);
    const last = list.body.data[list.body.data.length - 1];
    expect(last.body).toBe('Hello vendor!');

    // Mark read (no body → latest).
    const read = await request(APP_URL)
      .post(`/api/v1/conversations/${conversationId}/read`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({});
    expect(read.status).toBe(201);

    // Vendor's conversation list now reports unread_count = 0.
    const listConvos = await request(APP_URL)
      .get('/api/v1/conversations')
      .set('Authorization', `Bearer ${vendorToken}`);
    expect(listConvos.status).toBe(200);
    const found = (
      listConvos.body.data as Array<{
        conversation: { id: string };
        unreadCount: number;
      }>
    ).find((c) => c.conversation.id === conversationId);
    expect(found).toBeTruthy();
    expect(found!.unreadCount).toBe(0);
  });

  it('should rejects sending without body or attachments (422)', async () => {
    const res = await request(APP_URL)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({});
    expect(res.status).toBe(422);
  });

  it('should non-participant gets 403 listing messages', async () => {
    const res = await request(APP_URL)
      .get(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
  });

  it('should paginates 25 inserted messages with limit=10', async () => {
    // Insert 25 short messages from the buyer.
    for (let i = 0; i < 25; i++) {
      const r = await request(APP_URL)
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ body: `m${i}` });
      expect(r.status).toBe(201);
    }
    const page1 = await request(APP_URL)
      .get(`/api/v1/conversations/${conversationId}/messages?limit=10`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(page1.status).toBe(200);
    expect(page1.body.data.length).toBe(10);
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await request(APP_URL)
      .get(
        `/api/v1/conversations/${conversationId}/messages?limit=10&cursor=${encodeURIComponent(
          page1.body.nextCursor,
        )}`,
      )
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(page2.status).toBe(200);
    expect(page2.body.data.length).toBe(10);
    // Page2 should be older than page1 (created_at strictly less).
    const p1Oldest = new Date(page1.body.data[0].createdAt).getTime();
    const p2Newest = new Date(
      page2.body.data[page2.body.data.length - 1].createdAt,
    ).getTime();
    expect(p2Newest).toBeLessThan(p1Oldest);
  });

  // ── Block prevents send ──────────────────────────────────────────────

  it('should blocking the counterparty prevents sending', async () => {
    // Buyer blocks the vendor's user.
    const blk = await request(APP_URL)
      .post(`/api/v1/users/${vendorUserId}/block`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(blk.status).toBe(201);

    const send = await request(APP_URL)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ body: 'after-block' });
    expect(send.status).toBe(403);

    // Reverse direction also blocked: vendor → buyer.
    const sendV = await request(APP_URL)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ body: 'vendor-after-block' });
    expect(sendV.status).toBe(403);

    // Unblock and re-send should succeed.
    const unblk = await request(APP_URL)
      .delete(`/api/v1/users/${vendorUserId}/block`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(unblk.status).toBe(200);

    const send2 = await request(APP_URL)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ body: 'after-unblock' });
    expect(send2.status).toBe(201);
  });

  it('should cannot block self (422)', async () => {
    const res = await request(APP_URL)
      .post(`/api/v1/users/${buyerUserId}/block`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(422);
  });

  // ── Archive ─────────────────────────────────────────────────────────

  it('should archive flips conversation visibility on list', async () => {
    const archive = await request(APP_URL)
      .patch(`/api/v1/conversations/${conversationId}/archive`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ archived: true });
    expect(archive.status).toBe(200);

    const def = await request(APP_URL)
      .get('/api/v1/conversations')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(def.status).toBe(200);
    const inDefault = (
      def.body.data as Array<{ conversation: { id: string } }>
    ).find((c) => c.conversation.id === conversationId);
    expect(inDefault).toBeFalsy();

    const archived = await request(APP_URL)
      .get('/api/v1/conversations?archived=true')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(archived.status).toBe(200);
    const inArchived = (
      archived.body.data as Array<{ conversation: { id: string } }>
    ).find((c) => c.conversation.id === conversationId);
    expect(inArchived).toBeTruthy();

    // Restore for downstream tests.
    await request(APP_URL)
      .patch(`/api/v1/conversations/${conversationId}/archive`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ archived: false });
  });

  // ── ORDER kind: validate suborder participation ─────────────────────

  it('should places a suborder, then creates an ORDER conversation for it', async () => {
    // Build a product/variant/zone for this vendor so we can check out.
    const product = await request(APP_URL)
      .post('/api/v1/vendor/products')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        slug: productSlug,
        nameTranslations: { en: 'Chat Tee' },
        baseCurrency: 'SAR',
      });
    expect(product.status).toBe(201);
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
    expect(generated.status).toBe(201);
    const variantIds: string[] = (generated.body as Array<{ id: string }>).map(
      (v) => v.id,
    );

    for (const vid of variantIds) {
      await request(APP_URL)
        .patch(`/api/v1/vendor/products/${productId}/variants/${vid}/prices`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ regionId: saRegionId, priceMinorUnits: '9900' });
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

    const addCart = await request(APP_URL)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ variantId: variantIds[0], quantity: 1 });
    expect(addCart.status).toBe(201);

    const place = await request(APP_URL)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Idempotency-Key', `idem-chat-${ts}-aaaaaaaaaaaaa`)
      .send({ address: saAddress, paymentMethod: 'COD' });
    expect(place.status).toBe(201);
    placedSubOrderId = place.body.subOrders[0].id as string;
  });

  it('should creates an ORDER conversation; non-participant gets 403; idempotent', async () => {
    // Other user (not buyer/vendor of the suborder) → 403.
    const denied = await request(APP_URL)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ kind: 'ORDER', subOrderId: placedSubOrderId });
    expect(denied.status).toBe(403);

    // Buyer creates → 201.
    const first = await request(APP_URL)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ kind: 'ORDER', subOrderId: placedSubOrderId });
    expect(first.status).toBe(201);
    expect(first.body.kind).toBe('ORDER');
    expect(first.body.subOrderId).toBe(placedSubOrderId);
    orderConversationId = first.body.id as string;

    // Vendor re-creates → same id.
    const second = await request(APP_URL)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ kind: 'ORDER', subOrderId: placedSubOrderId });
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(orderConversationId);
  });

  it('should rate-limit the 31st unreplied DIRECT message per pair', async () => {
    const signup = await request(APP_URL)
      .post('/api/v1/vendor/signup')
      .send({
        email: `chat-spam-vendor-${ts}@example.com`,
        password: vendorPassword,
        firstName: 'Spam',
        lastName: 'Vendor',
        name: `Spam Shop ${ts}`,
      });
    expect(signup.status).toBe(201);
    spamVendorId = signup.body.id as string;
    const approve = await request(APP_URL)
      .patch(`/api/v1/admin/vendors/${spamVendorId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(approve.status).toBe(200);
    const convo = await request(APP_URL)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ kind: 'DIRECT', vendorId: spamVendorId });
    expect(convo.status).toBe(201);
    spamConversationId = convo.body.id as string;

    for (let i = 0; i < 30; i++) {
      const send = await request(APP_URL)
        .post(`/api/v1/conversations/${spamConversationId}/messages`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ body: `spam-${i}` });
      expect(send.status).toBe(201);
    }
    const limited = await request(APP_URL)
      .post(`/api/v1/conversations/${spamConversationId}/messages`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ body: 'spam-30' });
    expect(limited.status).toBe(429);
    expect(limited.body.message).toBe('rate_limited');
  });

  // ── Report dedup ────────────────────────────────────────────────────

  it('should reports a conversation; duplicate OPEN report is rejected (422); admin resolves', async () => {
    const r1 = await request(APP_URL)
      .post(`/api/v1/conversations/${conversationId}/report`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ reason: 'Spam in messages' });
    expect(r1.status).toBe(201);
    const reportId = r1.body.id as string;

    const r2 = await request(APP_URL)
      .post(`/api/v1/conversations/${conversationId}/report`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ reason: 'Spam again' });
    expect(r2.status).toBe(422);

    const list = await request(APP_URL)
      .get('/api/v1/admin/conversation-reports')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    const found = (list.body.data as Array<{ id: string }>).find(
      (r) => r.id === reportId,
    );
    expect(found).toBeTruthy();

    const upd = await request(APP_URL)
      .patch(`/api/v1/admin/conversation-reports/${reportId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'RESOLVED' });
    expect(upd.status).toBe(200);
    expect(upd.body.status).toBe('RESOLVED');

    // After resolve, the buyer can submit a fresh report.
    const r3 = await request(APP_URL)
      .post(`/api/v1/conversations/${conversationId}/report`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ reason: 'Different issue' });
    expect(r3.status).toBe(201);
  });

  // Just touch otherUserId so noUnusedLocals stays happy in CI builds.
  it('should snapshot of acquired ids', () => {
    expect(typeof otherUserId).toBe('number');
    expect(typeof orderConversationId).toBe('string');
    expect(typeof spamConversationId).toBe('string');
  });
});
