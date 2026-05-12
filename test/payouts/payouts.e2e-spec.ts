/**
 * Payouts — end-to-end happy-path tests
 *
 * Flow under test:
 *   1. Vendor signs up, uploads KYC docs, admin approves all docs + activates
 *      the vendor.
 *   2. A buyer places a COD order, the vendor ships, the buyer confirms delivery.
 *   3. onSubOrderDelivered() fires and writes an EARNING ledger entry.
 *   4. Admin triggers the batch cron manually (POST /api/v1/admin/payouts/batches).
 *   5. The vendor's EARNING collapses into a PENDING VendorPayout row, and the
 *      batch CSV is downloadable.
 *   6. Admin walks the payout to ISSUED → PAID; vendor's lifetimePaid increases.
 *
 * Additionally, a KYC-gate test verifies that a still-PENDING vendor (who has
 * a positive ledger via manual adjustment) does NOT get swept into the batch.
 */
import request from 'supertest';
import { APP_URL } from '../utils/constants';
import {
  adminLogin,
  vendorSignup,
  approveVendorFully,
  seedDeliveredSubOrder,
  setHoldDaysZero,
} from '../utils/payouts-fixtures';

describe('Payouts (e2e)', () => {
  // Shared state across tests — populated in beforeAll.
  let adminToken = '';
  let vendorToken = '';
  let vendorId = '';

  // State captured from test 2 used by tests 3 and 4.
  let batchId = '';
  let payoutId = '';

  const ts = Date.now().toString();

  // Use unique cycle keys per test run to avoid idempotency conflicts with
  // batches that may already exist from previous runs (batches are unique per
  // cycle key and the service returns early if a batch already exists).
  // Cycle keys must match YYYY-Www format per TriggerBatchDto validation.
  // We encode the full timestamp as a year in the far future so each test run
  // gets its own unique batch namespace:
  //   year = 3000 + seconds-since-epoch-mod-6999  → unique per ~2 hours
  // Two distinct suffixes (W01/W02) are used for the two batches.
  const uniqueYear = 3000 + (Math.floor(Number(ts) / 1000) % 6999);
  const cycleKey = `${uniqueYear}-W01`;
  const kycGateCycleKey = `${uniqueYear}-W02`;

  beforeAll(async () => {
    // 1. Admin login.
    adminToken = await adminLogin();

    // 2. Set hold days to 0 so earnings become immediately available.
    await setHoldDaysZero(adminToken);

    // 3. Vendor signup + full KYC + activation.
    const { vendorId: vid, vendorToken: vtok } = await vendorSignup(ts);
    vendorId = vid;
    vendorToken = vtok;

    // After signup the vendor is still PENDING and the token has role=user.
    // approveVendorFully uploads 4 KYC docs and activates the vendor.
    await approveVendorFully(adminToken, vendorToken, vendorId);

    // Re-login to get a token with the vendor role now that we are ACTIVE.
    const reLogin = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({
        email: `payout-vendor-${ts}@example.com`,
        password: 'Pass1234!',
      });
    vendorToken = reLogin.body.token as string;
  }, 180000);

  // ---------------------------------------------------------------------------
  // Test 1: Balance starts at zero before any delivery.
  // ---------------------------------------------------------------------------
  it('should show vendor balance at zero before any delivery', async () => {
    const res = await request(APP_URL)
      .get('/api/v1/vendor/payouts/balance')
      .set('Authorization', `Bearer ${vendorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.availableBalanceMinor).toBe('0');
    expect(res.body.heldBalanceMinor).toBe('0');
    expect(res.body.lifetimePaidMinor).toBe('0');
  }, 30000);

  // ---------------------------------------------------------------------------
  // Test 2: Delivery credits the vendor; cron sweeps into a PENDING payout;
  //         CSV is downloadable.
  // ---------------------------------------------------------------------------
  it('should credit vendor on delivery, sweep into PENDING payout, and serve a downloadable CSV', async () => {
    // a) Seed a fully-delivered sub-order (price = 10 000 minor = 100 SAR).
    await seedDeliveredSubOrder(adminToken, vendorToken, vendorId, '10000');

    // b) Balance should now be positive (hold_days = 0, so no held amount).
    const balAfter = await request(APP_URL)
      .get('/api/v1/vendor/payouts/balance')
      .set('Authorization', `Bearer ${vendorToken}`);
    expect(balAfter.status).toBe(200);

    const available = BigInt(balAfter.body.availableBalanceMinor as string);
    expect(available).toBeGreaterThan(0n);

    // c) Vendor's ledger shows an EARNING entry.
    const ledger = await request(APP_URL)
      .get('/api/v1/vendor/payouts/ledger')
      .set('Authorization', `Bearer ${vendorToken}`);
    expect(ledger.status).toBe(200);
    const entries = ledger.body.data as Array<{ type: string }>;
    expect(entries.some((e) => e.type === 'EARNING')).toBe(true);

    // d) Admin triggers a batch sweep manually using a unique cycleKey to
    //    avoid idempotency conflicts with batches from previous test runs.
    const trigger = await request(APP_URL)
      .post('/api/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cycleKey });
    expect(trigger.status).toBe(200);
    batchId = trigger.body.batchId as string;
    expect(batchId).toBeTruthy();

    // e) The payout row should exist with status=PENDING.
    const payoutsRes = await request(APP_URL)
      .get(`/api/v1/admin/payouts?vendorId=${vendorId}&cycleKey=${cycleKey}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(payoutsRes.status).toBe(200);
    const payoutRows = payoutsRes.body.data as Array<{
      id: string;
      status: string;
      amountMinor: number;
    }>;
    expect(payoutRows.length).toBeGreaterThanOrEqual(1);
    const pending = payoutRows.find((p) => p.status === 'PENDING');
    expect(pending).toBeDefined();
    payoutId = pending!.id;

    // f) The amount matches the vendor's available balance.
    expect(BigInt(pending!.amountMinor)).toBe(available);

    // g) CSV is downloadable.
    const csv = await request(APP_URL)
      .get(`/api/v1/admin/payouts/batches/${batchId}/csv`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/i);
    // The CSV body must be non-empty and contain the vendor's payout row.
    expect(csv.text.length).toBeGreaterThan(0);
    expect(csv.text).toContain(vendorId);
  }, 120000);

  // ---------------------------------------------------------------------------
  // Test 3: Admin marks PAID end-to-end; payout is PAID and lifetimePaid > 0.
  //
  // Note: lifetimePaid is already counted when the batch runs (via a
  // PAYOUT_ISSUED ledger debit).  Marking PAID only flips the payout status
  // and sets paid_at; it does not add a new ledger entry.  So we assert that
  // (a) the state machine transitions succeed, (b) the payout has status PAID
  // with a paid_at timestamp, and (c) the vendor sees lifetimePaid > 0.
  // ---------------------------------------------------------------------------
  it('should mark payout PAID end-to-end; payout status flips and lifetimePaid is positive', async () => {
    // lifetimePaid should already be positive because the batch (test 2) wrote
    // a PAYOUT_ISSUED debit entry.
    const before = await request(APP_URL)
      .get('/api/v1/vendor/payouts/balance')
      .set('Authorization', `Bearer ${vendorToken}`);
    expect(before.status).toBe(200);
    const lifetimePaid = BigInt(before.body.lifetimePaidMinor as string);
    expect(lifetimePaid).toBeGreaterThan(0n);

    // Step 1: PENDING → ISSUED.
    const issueRes = await request(APP_URL)
      .patch(`/api/v1/admin/payouts/${payoutId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ISSUED' });
    expect(issueRes.status).toBe(200);
    expect(issueRes.body.ok).toBe(true);

    // Step 2: ISSUED → PAID.
    const paidRes = await request(APP_URL)
      .patch(`/api/v1/admin/payouts/${payoutId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'PAID' });
    expect(paidRes.status).toBe(200);
    expect(paidRes.body.ok).toBe(true);

    // The payout itself should now show status=PAID and have a paid_at timestamp.
    const payoutDetail = await request(APP_URL)
      .get(`/api/v1/vendor/payouts/${payoutId}`)
      .set('Authorization', `Bearer ${vendorToken}`);
    expect(payoutDetail.status).toBe(200);
    expect(payoutDetail.body.payout.status).toBe('PAID');

    // Verify via the admin list too.
    const adminDetail = await request(APP_URL)
      .get(`/api/v1/admin/payouts?vendorId=${vendorId}&cycleKey=${cycleKey}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminDetail.status).toBe(200);
    const rows = adminDetail.body.data as Array<{
      id: string;
      status: string;
      paidAt: string | null;
    }>;
    const paid = rows.find((r) => r.id === payoutId);
    expect(paid).toBeDefined();
    expect(paid!.status).toBe('PAID');
    expect(paid!.paidAt).not.toBeNull();
  }, 60000);

  // ---------------------------------------------------------------------------
  // Test 4: KYC gate — pending-KYC vendor does NOT appear in batch even with
  //         a positive ledger (seeded via admin adjustment).
  // ---------------------------------------------------------------------------
  it('should exclude pending-KYC vendor from batch even with positive ledger (via admin adjustment)', async () => {
    // Create a second vendor that stays in PENDING state (no KYC approval).
    const pendingTs = `${Date.now()}-kyc-gate`;
    const { vendorId: pendingVendorId } = await vendorSignup(pendingTs);

    // Admin injects a positive ledger entry directly.
    const adjustRes = await request(APP_URL)
      .post(`/api/v1/admin/vendors/${pendingVendorId}/ledger/adjustments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amountMinor: '9999', memo: 'test adjustment for KYC gate' });
    expect(adjustRes.status).toBe(201);

    // Trigger a fresh batch using the per-run KYC gate cycle key.
    const batchRes = await request(APP_URL)
      .post('/api/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cycleKey: kycGateCycleKey });
    expect(batchRes.status).toBe(200);
    const newBatchId = batchRes.body.batchId as string;

    // List payouts for this new batch cycle — the pending vendor must NOT appear.
    const payoutsRes = await request(APP_URL)
      .get(
        `/api/v1/admin/payouts?vendorId=${pendingVendorId}&cycleKey=${kycGateCycleKey}`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect(payoutsRes.status).toBe(200);
    const rows = payoutsRes.body.data as Array<{ status: string }>;
    expect(rows.length).toBe(0);

    // CSV for this new batch also must NOT contain the pending vendor's ID.
    const csvRes = await request(APP_URL)
      .get(`/api/v1/admin/payouts/batches/${newBatchId}/csv`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(csvRes.status).toBe(200);
    expect(csvRes.text).not.toContain(pendingVendorId);
  }, 120000);
});
