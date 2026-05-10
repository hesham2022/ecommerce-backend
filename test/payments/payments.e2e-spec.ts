import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { useContainer } from 'class-validator';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import {
  PaymentProviderName,
  PaymentStatus,
} from '../../src/payments/domain/payment-enums';
import { PaymentProviderRegistry } from '../../src/payments/providers/payment-provider.registry';
import validationOptions from '../../src/utils/validation-options';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../utils/constants';

/**
 * Tasks 17 + 18 — e2e for the CARD checkout + webhook flow.
 *
 * Unlike the other e2e specs (which hit a running container via APP_URL), this
 * spec bootstraps the app in-process so the Stripe gateway can be mocked at the
 * PaymentProviderRegistry boundary. DB / Redis / Mail are real (the same .env).
 */
describe('Payments e2e (CARD flow)', () => {
  let app: INestApplication;
  let httpServer: ReturnType<INestApplication['getHttpServer']>;
  let providerStub: {
    name: PaymentProviderName;
    createIntent: jest.Mock;
    verifyAndParseWebhook: jest.Mock;
  };

  // Fixture state — unique per run to avoid collisions on the shared DB.
  const ts = Date.now();
  const vendorEmail = `pay-vendor-${ts}@example.com`;
  const vendorPassword = 'Pass1234!';
  const buyerEmail = `pay-buyer-${ts}@example.com`;
  const buyerPassword = 'Pass1234!';
  const shopName = `Pay Shop ${ts}`;
  const productSlug = `pay-tee-${ts}`;
  let buyerToken = '';
  const variantIds: string[] = [];

  const saAddress = {
    fullName: 'Test Buyer',
    phone: '+966555012999',
    country: 'SA',
    region: 'Riyadh',
    city: 'Riyadh',
    postalCode: '12345',
    street: '1 Test St',
    notes: null as string | null,
  };

  const validKey = (label: string) =>
    `idem-${label}-${ts}-xxxxxxxxxxxxx`.slice(0, 64);

  beforeAll(async () => {
    providerStub = {
      name: PaymentProviderName.STRIPE,
      createIntent: jest.fn(),
      verifyAndParseWebhook: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PaymentProviderRegistry)
      .useValue({ get: () => providerStub })
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    useContainer(app.select(AppModule), { fallbackOnErrors: true });
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(new ValidationPipe(validationOptions));
    await app.init();
    httpServer = app.getHttpServer();

    // ----- Fixture setup via HTTP, mirroring orders.e2e-spec.ts -----

    // 1. Admin login (admin is seeded by the project)
    const adminLogin = await request(httpServer)
      .post('/api/v1/auth/email/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(adminLogin.status).toBe(200);
    const adminToken = adminLogin.body.token as string;

    // 2. Resolve the SA region id (needed when setting variant prices)
    const regions = await request(httpServer).get('/api/v1/regions');
    expect(regions.status).toBe(200);
    const saRegionId =
      (regions.body as Array<{ id: string; code: string }>).find(
        (r) => r.code === 'SA',
      )?.id ?? '';
    expect(saRegionId).toBeTruthy();

    // 3. Vendor signup + admin approval
    const vendorSignup = await request(httpServer)
      .post('/api/v1/vendor/signup')
      .send({
        email: vendorEmail,
        password: vendorPassword,
        firstName: 'Pay',
        lastName: 'Vendor',
        name: shopName,
      });
    expect(vendorSignup.status).toBe(201);
    const vendorId = vendorSignup.body.id as string;

    const approve = await request(httpServer)
      .patch(`/api/v1/admin/vendors/${vendorId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(approve.status).toBe(200);

    const vendorLogin = await request(httpServer)
      .post('/api/v1/auth/email/login')
      .send({ email: vendorEmail, password: vendorPassword });
    expect(vendorLogin.status).toBe(200);
    const vendorToken = vendorLogin.body.token as string;

    // 4. Vendor creates a product
    const product = await request(httpServer)
      .post('/api/v1/vendor/products')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        slug: productSlug,
        nameTranslations: { en: 'Pay Tee', ar: 'تي شيرت' },
        baseCurrency: 'SAR',
      });
    expect(product.status).toBe(201);
    const productId = product.body.id as string;

    // Generate variants (one option type with two values → two variants).
    const generated = await request(httpServer)
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
    variantIds.push(
      ...(generated.body as Array<{ id: string }>).map((v) => v.id),
    );
    expect(variantIds.length).toBeGreaterThan(0);

    // Set price + stock for each variant.
    for (const vid of variantIds) {
      await request(httpServer)
        .patch(`/api/v1/vendor/products/${productId}/variants/${vid}/prices`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ regionId: saRegionId, priceMinorUnits: '9900' });
      await request(httpServer)
        .patch(`/api/v1/vendor/products/${productId}/variants/${vid}/stock`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ quantity: 25 });
    }

    await request(httpServer)
      .post(`/api/v1/vendor/products/${productId}/publish`)
      .set('Authorization', `Bearer ${vendorToken}`);

    // Vendor needs an SA shipping zone so SA addresses can quote/place.
    await request(httpServer)
      .post('/api/v1/vendor/shipping-zones')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        name: 'SA',
        countryCodes: ['SA'],
        costMinorUnits: '2500',
        currencyCode: 'SAR',
        estDeliveryDaysMin: 1,
        estDeliveryDaysMax: 3,
      });

    // 5. Buyer signup (vendor signup creates an active user — same trick as
    //    orders.e2e-spec). Buyer doesn't need approval to place orders.
    const buyerSignup = await request(httpServer)
      .post('/api/v1/vendor/signup')
      .send({
        email: buyerEmail,
        password: buyerPassword,
        firstName: 'Buy',
        lastName: 'Test',
        name: `Pay Buyer Shop ${ts}`,
      });
    expect(buyerSignup.status).toBe(201);

    const buyerLogin = await request(httpServer)
      .post('/api/v1/auth/email/login')
      .send({ email: buyerEmail, password: buyerPassword });
    expect(buyerLogin.status).toBe(200);
    buyerToken = buyerLogin.body.token as string;

    // 6. Buyer adds the variant to cart for the first test.
    const addToCart = await request(httpServer)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ variantId: variantIds[0], quantity: 1 });
    expect(addToCart.status).toBe(201);
  }, 120000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('should create a CARD order with clientSecret and flip to COLLECTED on succeeded webhook (idempotent)', async () => {
    providerStub.createIntent.mockResolvedValue({
      providerIntentId: `pi_${ts}_1`,
      clientSecret: `pi_${ts}_1_secret`,
      status: PaymentStatus.REQUIRES_ACTION,
    });

    // 1. Place a CARD order — provider stub returns the intent.
    const placeRes = await request(httpServer)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Idempotency-Key', validKey('K1'))
      .send({
        address: saAddress,
        paymentMethod: 'CARD',
        paymentProvider: 'STRIPE',
      });
    expect(placeRes.status).toBe(201);
    expect(placeRes.body.payment).toBeTruthy();
    expect(placeRes.body.payment.clientSecret).toBe(`pi_${ts}_1_secret`);
    expect(placeRes.body.payment.status).toBe('REQUIRES_ACTION');
    expect(placeRes.body.paymentStatus).toBe('PENDING');
    const orderId = placeRes.body.id as string;
    const paymentId = placeRes.body.payment.id as string;

    // 2. GET /payments/:id reflects the initial REQUIRES_ACTION state.
    const initial = await request(httpServer)
      .get(`/api/v1/payments/${paymentId}`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(initial.status).toBe(200);
    expect(initial.body.status).toBe('REQUIRES_ACTION');

    // 3. Stub the webhook parse → SUCCEEDED.
    providerStub.verifyAndParseWebhook.mockReturnValue({
      providerEventId: `evt_${ts}_1`,
      eventType: 'payment_intent.succeeded',
      providerIntentId: `pi_${ts}_1`,
      status: PaymentStatus.SUCCEEDED,
      errorMessage: null,
      raw: {},
    });

    // 4. Deliver the webhook.
    await request(httpServer)
      .post('/api/v1/payments/webhooks/stripe')
      .set('stripe-signature', 't=1,v1=anything')
      .set('content-type', 'application/json')
      .send({})
      .expect(204);

    // 5. Payment is now SUCCEEDED.
    const after = await request(httpServer)
      .get(`/api/v1/payments/${paymentId}`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(after.status).toBe(200);
    expect(after.body.status).toBe('SUCCEEDED');

    // 6. Order's paymentStatus is now COLLECTED.
    const orderAfter = await request(httpServer)
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(orderAfter.status).toBe(200);
    expect(orderAfter.body.paymentStatus).toBe('COLLECTED');

    // 7. Re-deliver the same webhook event → idempotent no-op.
    await request(httpServer)
      .post('/api/v1/payments/webhooks/stripe')
      .set('stripe-signature', 't=1,v1=anything')
      .set('content-type', 'application/json')
      .send({})
      .expect(204);

    // Status unchanged.
    const replay = await request(httpServer)
      .get(`/api/v1/payments/${paymentId}`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(replay.status).toBe(200);
    expect(replay.body.status).toBe('SUCCEEDED');
  }, 120000);

  it('should mark payment FAILED and cancel sub-orders when payment_intent.payment_failed arrives', async () => {
    // Re-stock the cart for the second order (use a different variant to
    // sidestep any stock contention with the first test's reservation).
    const variantForFailure = variantIds[1] ?? variantIds[0];
    const addAgain = await request(httpServer)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ variantId: variantForFailure, quantity: 1 });
    expect(addAgain.status).toBe(201);

    providerStub.createIntent.mockResolvedValue({
      providerIntentId: `pi_${ts}_2`,
      clientSecret: `pi_${ts}_2_secret`,
      status: PaymentStatus.REQUIRES_ACTION,
    });

    const placeRes = await request(httpServer)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Idempotency-Key', validKey('K2'))
      .send({
        address: saAddress,
        paymentMethod: 'CARD',
        paymentProvider: 'STRIPE',
      });
    expect(placeRes.status).toBe(201);
    const orderId = placeRes.body.id as string;
    const paymentId = placeRes.body.payment.id as string;

    providerStub.verifyAndParseWebhook.mockReturnValue({
      providerEventId: `evt_${ts}_2`,
      eventType: 'payment_intent.payment_failed',
      providerIntentId: `pi_${ts}_2`,
      status: PaymentStatus.FAILED,
      errorMessage: 'card declined',
      raw: {},
    });

    await request(httpServer)
      .post('/api/v1/payments/webhooks/stripe')
      .set('stripe-signature', 't=1,v1=x')
      .set('content-type', 'application/json')
      .send({})
      .expect(204);

    const paymentAfter = await request(httpServer)
      .get(`/api/v1/payments/${paymentId}`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(paymentAfter.status).toBe(200);
    expect(paymentAfter.body.status).toBe('FAILED');
    expect(paymentAfter.body.lastError).toBe('card declined');

    const orderAfter = await request(httpServer)
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(orderAfter.status).toBe(200);
    expect(orderAfter.body.paymentStatus).toBe('FAILED');
    for (const so of orderAfter.body.subOrders ?? []) {
      expect(so.fulfillmentStatus).toBe('CANCELLED');
    }
  }, 120000);

  it('should reject a webhook with an invalid signature with 400', async () => {
    providerStub.verifyAndParseWebhook.mockImplementation(() => {
      throw new Error('Invalid signature');
    });

    await request(httpServer)
      .post('/api/v1/payments/webhooks/stripe')
      .set('stripe-signature', 't=1,v1=bad')
      .set('content-type', 'application/json')
      .send({})
      .expect(400);
  });
});
