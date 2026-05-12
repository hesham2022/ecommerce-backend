/**
 * Reusable fixture helpers for the payouts e2e tests.
 *
 * These helpers mirror the patterns from test/kyc/kyc.e2e-spec.ts and
 * test/returns/returns.e2e-spec.ts — they call the live API server and
 * return whatever callers need (tokens, IDs, etc.).
 */
import request from 'supertest';
import { APP_URL } from './constants';

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

export async function adminLogin(): Promise<string> {
  const res = await request(APP_URL)
    .post('/api/v1/auth/email/login')
    .send({ email: 'admin@example.com', password: 'secret' });
  if (res.status >= 400) {
    throw new Error(
      `adminLogin failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return res.body.token as string;
}

/**
 * Signs up a fresh vendor account.  The account stays PENDING until
 * `approveVendorFully` is called.
 *
 * @param suffix  A unique string (e.g. Date.now().toString()) to avoid e-mail
 *                collisions between test runs.
 * @returns       { vendorId, vendorToken } — note the token can already be
 *                used even while PENDING (KYC upload works with PENDING status).
 */
export async function vendorSignup(suffix: string): Promise<{
  vendorId: string;
  vendorToken: string;
  vendorEmail: string;
}> {
  const vendorEmail = `payout-vendor-${suffix}@example.com`;
  const vendorPassword = 'Pass1234!';

  const signup = await request(APP_URL)
    .post('/api/v1/vendor/signup')
    .send({
      email: vendorEmail,
      password: vendorPassword,
      firstName: 'Payout',
      lastName: 'Vendor',
      name: `Payout Shop ${suffix}`,
    });
  if (signup.status >= 400) {
    throw new Error(
      `vendorSignup failed: ${signup.status} ${JSON.stringify(signup.body)}`,
    );
  }
  const vendorId = signup.body.id as string;

  const login = await request(APP_URL)
    .post('/api/v1/auth/email/login')
    .send({ email: vendorEmail, password: vendorPassword });
  if (login.status >= 400) {
    throw new Error(
      `vendor login failed: ${login.status} ${JSON.stringify(login.body)}`,
    );
  }
  const vendorToken = login.body.token as string;

  return { vendorId, vendorToken, vendorEmail };
}

// ---------------------------------------------------------------------------
// File presign helper (used by KYC doc upload)
// ---------------------------------------------------------------------------

async function createFileFor(token: string): Promise<string> {
  const presign = await request(APP_URL)
    .post('/api/v1/files/presign')
    .set('Authorization', `Bearer ${token}`)
    .send({
      fileName: `kyc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.pdf`,
      fileSize: 1024,
      purpose: 'general',
    });
  if (presign.status >= 400) {
    throw new Error(
      `presign failed: ${presign.status} ${JSON.stringify(presign.body)}`,
    );
  }
  return presign.body.fileId as string;
}

// ---------------------------------------------------------------------------
// KYC + vendor activation
// ---------------------------------------------------------------------------

/**
 * Uploads all 4 required KYC docs (as vendor), admin-approves each one, and
 * admin-activates the vendor.  After this call the vendor is ACTIVE with
 * kycStatus=APPROVED.
 */
export async function approveVendorFully(
  adminToken: string,
  vendorToken: string,
  vendorId: string,
): Promise<void> {
  // 1. Upload COMMERCIAL_REGISTRATION
  const crFileId = await createFileFor(vendorToken);
  const crRes = await request(APP_URL)
    .post('/api/v1/vendor/kyc/documents')
    .set('Authorization', `Bearer ${vendorToken}`)
    .send({
      type: 'COMMERCIAL_REGISTRATION',
      fileId: crFileId,
      details: { number: 'CR-PAY-1', issueDate: '2024-01-01' },
    });
  if (crRes.status !== 201) {
    throw new Error(
      `CR upload failed: ${crRes.status} ${JSON.stringify(crRes.body)}`,
    );
  }

  // 2. Upload TAX_CERTIFICATE
  const taxFileId = await createFileFor(vendorToken);
  const taxRes = await request(APP_URL)
    .post('/api/v1/vendor/kyc/documents')
    .set('Authorization', `Bearer ${vendorToken}`)
    .send({
      type: 'TAX_CERTIFICATE',
      fileId: taxFileId,
      details: { taxNumber: 'TAX-PAY-1' },
    });
  if (taxRes.status !== 201) {
    throw new Error(
      `TAX upload failed: ${taxRes.status} ${JSON.stringify(taxRes.body)}`,
    );
  }

  // 3. Upload IBAN_DOCUMENT — IBAN details are required
  const ibanFileId = await createFileFor(vendorToken);
  const ibanRes = await request(APP_URL)
    .post('/api/v1/vendor/kyc/documents')
    .set('Authorization', `Bearer ${vendorToken}`)
    .send({
      type: 'IBAN_DOCUMENT',
      fileId: ibanFileId,
      details: { iban: 'SA0380000000608010167519', bankName: 'BankX' },
    });
  if (ibanRes.status !== 201) {
    throw new Error(
      `IBAN upload failed: ${ibanRes.status} ${JSON.stringify(ibanRes.body)}`,
    );
  }

  // 4. Upload OWNER_ID
  const ownerFileId = await createFileFor(vendorToken);
  const ownerRes = await request(APP_URL)
    .post('/api/v1/vendor/kyc/documents')
    .set('Authorization', `Bearer ${vendorToken}`)
    .send({
      type: 'OWNER_ID',
      fileId: ownerFileId,
      details: { nationalId: '1234567890' },
    });
  if (ownerRes.status !== 201) {
    throw new Error(
      `OWNER_ID upload failed: ${ownerRes.status} ${JSON.stringify(ownerRes.body)}`,
    );
  }

  // 5. Admin fetches queue for this vendor and approves each doc
  const queue = await request(APP_URL)
    .get(`/api/v1/admin/kyc/queue?status=PENDING&vendorId=${vendorId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  if (queue.status !== 200) {
    throw new Error(
      `kyc queue fetch failed: ${queue.status} ${JSON.stringify(queue.body)}`,
    );
  }

  const docs = queue.body.data as Array<{ id: string }>;
  for (const doc of docs) {
    const review = await request(APP_URL)
      .patch(`/api/v1/admin/kyc/documents/${doc.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'APPROVED' });
    if (review.status !== 200) {
      throw new Error(
        `doc approve failed for ${doc.id}: ${review.status} ${JSON.stringify(review.body)}`,
      );
    }
  }

  // 6. Admin activates the vendor
  const activate = await request(APP_URL)
    .patch(`/api/v1/admin/vendors/${vendorId}/approve`)
    .set('Authorization', `Bearer ${adminToken}`);
  if (activate.status !== 200) {
    throw new Error(
      `vendor activate failed: ${activate.status} ${JSON.stringify(activate.body)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Order flow — creates a product, places an order, drives to DELIVERED
// ---------------------------------------------------------------------------

const SA_ADDRESS = {
  fullName: 'Payout Buyer',
  phone: '+966555099999',
  country: 'SA',
  region: 'Riyadh',
  city: 'Riyadh',
  postalCode: '12345',
  street: 'Payout st 1',
  notes: null,
};

/**
 * Creates a minimal product+variant for the given vendor, signs up a buyer,
 * places a COD order, and drives the sub-order all the way to DELIVERED (buyer
 * calls confirm-delivery).
 *
 * @param adminToken   Admin JWT (unused directly but accepted for symmetry).
 * @param vendorToken  Vendor JWT — must be for an ACTIVE vendor.
 * @param vendorId     UUID of the vendor (used only for logging/debug).
 * @param amountMinor  Price per unit in minor units (e.g. '5000' = 50 SAR).
 *                     This is also the subtotalMinor that ends up in the
 *                     ledger earning.
 * @returns            { orderId, subOrderId, buyerToken }
 */
export async function seedDeliveredSubOrder(
  adminToken: string,
  vendorToken: string,
  vendorId: string,
  amountMinor: string,
): Promise<{ orderId: string; subOrderId: string; buyerToken: string }> {
  const ts = Date.now();

  // Resolve SA region
  const regions = await request(APP_URL).get('/api/v1/regions');
  const saRegion = (regions.body as Array<{ id: string; code: string }>).find(
    (r) => r.code === 'SA',
  );
  if (!saRegion) throw new Error('SA region not found in /api/v1/regions');
  const saRegionId = saRegion.id;

  // Create product
  const productSlug = `payout-product-${ts}-${vendorId.slice(0, 8)}`;
  const productRes = await request(APP_URL)
    .post('/api/v1/vendor/products')
    .set('Authorization', `Bearer ${vendorToken}`)
    .send({
      slug: productSlug,
      nameTranslations: { en: 'Payout Test Product', ar: 'منتج اختبار' },
      baseCurrency: 'SAR',
    });
  if (productRes.status !== 201) {
    throw new Error(
      `product create failed: ${productRes.status} ${JSON.stringify(productRes.body)}`,
    );
  }
  const productId = productRes.body.id as string;

  // Generate variant
  const generated = await request(APP_URL)
    .post(`/api/v1/vendor/products/${productId}/variants/generate`)
    .set('Authorization', `Bearer ${vendorToken}`)
    .send({
      optionTypes: [
        {
          slug: `size-${ts}`,
          nameTranslations: { en: 'Size' },
          values: [{ slug: `one-${ts}`, valueTranslations: { en: 'One' } }],
        },
      ],
    });
  if (generated.status !== 201) {
    throw new Error(
      `variant generate failed: ${generated.status} ${JSON.stringify(generated.body)}`,
    );
  }
  const variantId = (generated.body as Array<{ id: string }>)[0].id;

  // Set price
  await request(APP_URL)
    .patch(`/api/v1/vendor/products/${productId}/variants/${variantId}/prices`)
    .set('Authorization', `Bearer ${vendorToken}`)
    .send({ regionId: saRegionId, priceMinorUnits: amountMinor });

  // Set stock
  await request(APP_URL)
    .patch(`/api/v1/vendor/products/${productId}/variants/${variantId}/stock`)
    .set('Authorization', `Bearer ${vendorToken}`)
    .send({ quantity: 50 });

  // Publish product
  await request(APP_URL)
    .post(`/api/v1/vendor/products/${productId}/publish`)
    .set('Authorization', `Bearer ${vendorToken}`);

  // Set up shipping zone
  await request(APP_URL)
    .post('/api/v1/vendor/shipping-zones')
    .set('Authorization', `Bearer ${vendorToken}`)
    .send({
      name: `SA standard ${ts}`,
      countryCodes: ['SA'],
      costMinorUnits: '0',
      currencyCode: 'SAR',
      estDeliveryDaysMin: 1,
      estDeliveryDaysMax: 3,
    });

  // Sign up a buyer
  const buyerEmail = `payout-buyer-${ts}@example.com`;
  const buyerPassword = 'Pass1234!';
  await request(APP_URL)
    .post('/api/v1/vendor/signup')
    .send({
      email: buyerEmail,
      password: buyerPassword,
      firstName: 'Payout',
      lastName: 'Buyer',
      name: `Payout Buyer Shop ${ts}`,
    });

  const buyerLogin = await request(APP_URL)
    .post('/api/v1/auth/email/login')
    .send({ email: buyerEmail, password: buyerPassword });
  if (buyerLogin.status >= 400) {
    throw new Error(
      `buyer login failed: ${buyerLogin.status} ${JSON.stringify(buyerLogin.body)}`,
    );
  }
  const buyerToken = buyerLogin.body.token as string;

  // Add to cart
  await request(APP_URL)
    .post('/api/v1/cart/items')
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({ variantId, quantity: 1 });

  // Place order
  const idemKey = `idem-payout-${ts}-${vendorId.slice(0, 8)}`.slice(0, 64);
  const place = await request(APP_URL)
    .post('/api/v1/orders')
    .set('Authorization', `Bearer ${buyerToken}`)
    .set('Idempotency-Key', idemKey)
    .send({ address: SA_ADDRESS, paymentMethod: 'COD' });
  if (place.status !== 201) {
    throw new Error(
      `order placement failed: ${place.status} ${JSON.stringify(place.body)}`,
    );
  }
  const orderId = place.body.id as string;
  const subOrderId = place.body.subOrders[0].id as string;

  // Drive sub-order: CONFIRMED → PACKED → SHIPPED
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
      trackingNumber: `TRK-PAY-${ts}`,
      courierName: 'Aramex',
    });

  // Buyer confirms delivery → DELIVERED triggers onSubOrderDelivered payout hook
  const confirm = await request(APP_URL)
    .post(`/api/v1/orders/${orderId}/suborders/${subOrderId}/confirm-delivery`)
    .set('Authorization', `Bearer ${buyerToken}`);
  if (confirm.status >= 400) {
    throw new Error(
      `confirm-delivery failed: ${confirm.status} ${JSON.stringify(confirm.body)}`,
    );
  }

  return { orderId, subOrderId, buyerToken };
}

// ---------------------------------------------------------------------------
// Settings helper
// ---------------------------------------------------------------------------

/**
 * Sets payout_hold_days to 0 so that earnings are immediately available for
 * the next batch run (no future availableAt).
 */
export async function setHoldDaysZero(adminToken: string): Promise<void> {
  const res = await request(APP_URL)
    .patch('/api/v1/admin/settings/payout_hold_days')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ value: 0 });
  if (res.status >= 400) {
    throw new Error(
      `setHoldDaysZero failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
}

/**
 * Sets payout_hold_days to the given value.
 */
export async function setHoldDays(
  adminToken: string,
  days: number,
): Promise<void> {
  const res = await request(APP_URL)
    .patch('/api/v1/admin/settings/payout_hold_days')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ value: days });
  if (res.status >= 400) {
    throw new Error(
      `setHoldDays(${days}) failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Returns / refund helper
// ---------------------------------------------------------------------------

/**
 * Drives an already-delivered sub-order through the full returns happy-path
 * (REQUESTED → APPROVED → SHIPPED_BACK → RECEIVED → REFUNDED) so that
 * `onReturnRefunded` fires and a REFUND_CLAWBACK ledger entry is written.
 *
 * @param orderId      The parent order UUID.
 * @param subOrderId   The sub-order UUID.
 * @param orderItemId  The order-item UUID (first item; used for the return request).
 * @param quantity     Number of units to return (must be ≤ ordered quantity).
 * @param buyerToken   JWT of the buyer who placed the original order.
 * @param vendorToken  JWT of the vendor who fulfills the return.
 */
export async function refundDeliveredOrder(input: {
  orderId: string;
  subOrderId: string;
  orderItemId: string;
  quantity: number;
  buyerToken: string;
  vendorToken: string;
}): Promise<{ returnId: string }> {
  const {
    orderId,
    subOrderId,
    orderItemId,
    quantity,
    buyerToken,
    vendorToken,
  } = input;

  // 1. Buyer opens RMA
  const create = await request(APP_URL)
    .post(`/api/v1/orders/${orderId}/suborders/${subOrderId}/returns`)
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({
      items: [{ orderItemId, quantity }],
      reason: 'DAMAGED',
      reasonNote: 'Arrived damaged during e2e test.',
    });
  if (create.status !== 201) {
    throw new Error(
      `return create failed: ${create.status} ${JSON.stringify(create.body)}`,
    );
  }
  const returnId = create.body.id as string;

  // 2. Vendor approves
  const approve = await request(APP_URL)
    .patch(`/api/v1/vendor/returns/${returnId}`)
    .set('Authorization', `Bearer ${vendorToken}`)
    .send({ status: 'APPROVED' });
  if (approve.status !== 200) {
    throw new Error(
      `return approve failed: ${approve.status} ${JSON.stringify(approve.body)}`,
    );
  }

  // 3. Buyer ships back
  const ship = await request(APP_URL)
    .patch(`/api/v1/returns/${returnId}/shipped-back`)
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({ trackingNumber: `TRK-BACK-${Date.now()}` });
  if (ship.status !== 200) {
    throw new Error(
      `return shipped-back failed: ${ship.status} ${JSON.stringify(ship.body)}`,
    );
  }

  // 4. Vendor marks RECEIVED (with restock)
  const recv = await request(APP_URL)
    .patch(`/api/v1/vendor/returns/${returnId}`)
    .set('Authorization', `Bearer ${vendorToken}`)
    .send({ status: 'RECEIVED', restock: true });
  if (recv.status !== 200) {
    throw new Error(
      `return received failed: ${recv.status} ${JSON.stringify(recv.body)}`,
    );
  }

  // 5. Vendor marks REFUNDED → triggers onReturnRefunded → REFUND_CLAWBACK
  const refund = await request(APP_URL)
    .patch(`/api/v1/vendor/returns/${returnId}`)
    .set('Authorization', `Bearer ${vendorToken}`)
    .send({ status: 'REFUNDED' });
  if (refund.status !== 200) {
    throw new Error(
      `return refund failed: ${refund.status} ${JSON.stringify(refund.body)}`,
    );
  }

  return { returnId };
}

/**
 * Extracts the first orderItemId from a placed order response.
 * Helper so callers don't need to know the exact response shape.
 */
export function firstOrderItemId(placeOrderBody: {
  subOrders: Array<{ items: Array<{ id: string }> }>;
}): string {
  return placeOrderBody.subOrders[0].items[0].id;
}
