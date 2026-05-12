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
  setHoldDays,
  refundDeliveredOrder,
  firstOrderItemId,
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

// =============================================================================
// Edge-case tests
// =============================================================================

describe('Payouts edge cases (e2e)', () => {
  // Shared admin token — obtained once in beforeAll.
  let adminToken = '';

  // Unique timestamp-based suffix so each run avoids email / slug collisions.
  const edgeTs = `edge-${Date.now()}`;

  // Compute a cycle-year namespace that differs from the happy-path suite's
  // namespace (happy path uses 3000+ range; we use 4000+ range here).
  const uniqueYear = 4000 + (Math.floor(Date.now() / 1000) % 6999);

  beforeAll(async () => {
    adminToken = await adminLogin();
  }, 30000);

  // ---------------------------------------------------------------------------
  // EC-1: Refund during hold window decrements available balance, no payout
  // ---------------------------------------------------------------------------
  describe('EC-1: refund during hold decrements held balance, no payout produced', () => {
    let vendorToken = '';
    let vendorId = '';
    let vendorEmail = '';

    beforeAll(async () => {
      // Set hold days to 14 so the earning is in held state.
      await setHoldDays(adminToken, 14);

      const suffix = `${edgeTs}-ec1`;
      const signup = await vendorSignup(suffix);
      vendorId = signup.vendorId;
      vendorEmail = signup.vendorEmail;

      await approveVendorFully(adminToken, signup.vendorToken, vendorId);

      // Re-login to get the vendor-role token.
      const reLogin = await request(APP_URL)
        .post('/api/v1/auth/email/login')
        .send({ email: vendorEmail, password: 'Pass1234!' });
      vendorToken = reLogin.body.token as string;
    }, 180000);

    afterAll(async () => {
      // Restore hold days to 0 so subsequent tests are unaffected.
      await setHoldDaysZero(adminToken);
    }, 30000);

    it('should write REFUND_CLAWBACK during hold; available balance goes negative', async () => {
      // Seed a delivered order — earning is held (hold_days=14).
      const { orderId, subOrderId, buyerToken } = await seedDeliveredSubOrder(
        adminToken,
        vendorToken,
        vendorId,
        '8000',
      );

      // Fetch the order to get the first item ID.
      const orderRes = await request(APP_URL)
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(orderRes.status).toBe(200);
      const orderItemId = firstOrderItemId(orderRes.body as any);

      // Balance: earning is held, nothing available.
      const balBefore = await request(APP_URL)
        .get('/api/v1/vendor/payouts/balance')
        .set('Authorization', `Bearer ${vendorToken}`);
      expect(balBefore.status).toBe(200);
      expect(BigInt(balBefore.body.heldBalanceMinor as string)).toBeGreaterThan(
        0n,
      );

      // Refund through the returns flow → triggers REFUND_CLAWBACK.
      await refundDeliveredOrder({
        orderId,
        subOrderId,
        orderItemId,
        quantity: 1,
        buyerToken,
        vendorToken,
      });

      // REFUND_CLAWBACK posts immediately (availableAt=now) as a negative amount.
      // Since the earning is still held, availableBalance should be negative.
      const balAfter = await request(APP_URL)
        .get('/api/v1/vendor/payouts/balance')
        .set('Authorization', `Bearer ${vendorToken}`);
      expect(balAfter.status).toBe(200);
      expect(
        BigInt(balAfter.body.availableBalanceMinor as string),
      ).toBeLessThan(0n);

      // Ledger should contain a REFUND_CLAWBACK entry.
      const ledger = await request(APP_URL)
        .get('/api/v1/vendor/payouts/ledger')
        .set('Authorization', `Bearer ${vendorToken}`);
      expect(ledger.status).toBe(200);
      const entries = ledger.body.data as Array<{ type: string }>;
      expect(entries.some((e) => e.type === 'REFUND_CLAWBACK')).toBe(true);
    }, 180000);
  });

  // ---------------------------------------------------------------------------
  // EC-2: Refund after payout → negative balance; next cycle skips vendor
  // ---------------------------------------------------------------------------
  describe('EC-2: refund after payout creates negative balance; next cycle skips', () => {
    let vendorToken = '';
    let vendorId = '';
    let vendorEmail = '';
    const ec2CycleKey = `${uniqueYear}-W03`;
    const ec2NextCycleKey = `${uniqueYear}-W04`;

    beforeAll(async () => {
      await setHoldDaysZero(adminToken);

      const suffix = `${edgeTs}-ec2`;
      const signup = await vendorSignup(suffix);
      vendorId = signup.vendorId;
      vendorEmail = signup.vendorEmail;

      await approveVendorFully(adminToken, signup.vendorToken, vendorId);

      const reLogin = await request(APP_URL)
        .post('/api/v1/auth/email/login')
        .send({ email: vendorEmail, password: 'Pass1234!' });
      vendorToken = reLogin.body.token as string;
    }, 180000);

    it('should give negative balance and negativeBalanceWarning after refund; next cycle skips vendor', async () => {
      // Seed a delivered order.
      const { orderId, subOrderId, buyerToken } = await seedDeliveredSubOrder(
        adminToken,
        vendorToken,
        vendorId,
        '9000',
      );

      const orderRes = await request(APP_URL)
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${buyerToken}`);
      expect(orderRes.status).toBe(200);
      const orderItemId = firstOrderItemId(orderRes.body as any);

      // Trigger a batch → vendor gets a PENDING payout.
      const batchRes = await request(APP_URL)
        .post('/api/v1/admin/payouts/batches')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ cycleKey: ec2CycleKey });
      expect(batchRes.status).toBe(200);

      // Confirm the payout was created.
      const payoutsAfterBatch = await request(APP_URL)
        .get(
          `/api/v1/admin/payouts?vendorId=${vendorId}&cycleKey=${ec2CycleKey}`,
        )
        .set('Authorization', `Bearer ${adminToken}`);
      expect(payoutsAfterBatch.status).toBe(200);
      expect(
        (payoutsAfterBatch.body.data as Array<{ status: string }>).some(
          (p) => p.status === 'PENDING',
        ),
      ).toBe(true);

      // Refund the order — PAYOUT_ISSUED already debited available, so the
      // clawback drives available further negative.
      await refundDeliveredOrder({
        orderId,
        subOrderId,
        orderItemId,
        quantity: 1,
        buyerToken,
        vendorToken,
      });

      // Balance is now negative; negativeBalanceWarning must be true.
      const balAfter = await request(APP_URL)
        .get('/api/v1/vendor/payouts/balance')
        .set('Authorization', `Bearer ${vendorToken}`);
      expect(balAfter.status).toBe(200);
      expect(
        BigInt(balAfter.body.availableBalanceMinor as string),
      ).toBeLessThan(0n);
      expect(balAfter.body.negativeBalanceWarning).toBe(true);

      // Trigger the NEXT batch — vendor must NOT appear (balance is negative).
      const nextBatchRes = await request(APP_URL)
        .post('/api/v1/admin/payouts/batches')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ cycleKey: ec2NextCycleKey });
      expect(nextBatchRes.status).toBe(200);

      const nextPayouts = await request(APP_URL)
        .get(
          `/api/v1/admin/payouts?vendorId=${vendorId}&cycleKey=${ec2NextCycleKey}`,
        )
        .set('Authorization', `Bearer ${adminToken}`);
      expect(nextPayouts.status).toBe(200);
      expect((nextPayouts.body.data as Array<unknown>).length).toBe(0);
    }, 180000);
  });

  // ---------------------------------------------------------------------------
  // EC-3: Admin marks payout FAILED → PAYOUT_REVERSED restores balance
  // ---------------------------------------------------------------------------
  describe('EC-3: FAILED payout writes PAYOUT_REVERSED and restores balance', () => {
    let vendorToken = '';
    let vendorId = '';
    let vendorEmail = '';
    const ec3CycleKey = `${uniqueYear}-W05`;

    beforeAll(async () => {
      await setHoldDaysZero(adminToken);

      const suffix = `${edgeTs}-ec3`;
      const signup = await vendorSignup(suffix);
      vendorId = signup.vendorId;
      vendorEmail = signup.vendorEmail;

      await approveVendorFully(adminToken, signup.vendorToken, vendorId);

      const reLogin = await request(APP_URL)
        .post('/api/v1/auth/email/login')
        .send({ email: vendorEmail, password: 'Pass1234!' });
      vendorToken = reLogin.body.token as string;
    }, 180000);

    it('should write PAYOUT_REVERSED on FAILED transition and restore available balance', async () => {
      // Seed a delivered order.
      await seedDeliveredSubOrder(adminToken, vendorToken, vendorId, '7000');

      // Available balance is positive at this point.
      const balBefore = await request(APP_URL)
        .get('/api/v1/vendor/payouts/balance')
        .set('Authorization', `Bearer ${vendorToken}`);
      expect(
        BigInt(balBefore.body.availableBalanceMinor as string),
      ).toBeGreaterThan(0n);

      // Trigger batch.
      const batchRes = await request(APP_URL)
        .post('/api/v1/admin/payouts/batches')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ cycleKey: ec3CycleKey });
      expect(batchRes.status).toBe(200);

      // Fetch the payout id.
      const payoutsRes = await request(APP_URL)
        .get(
          `/api/v1/admin/payouts?vendorId=${vendorId}&cycleKey=${ec3CycleKey}`,
        )
        .set('Authorization', `Bearer ${adminToken}`);
      expect(payoutsRes.status).toBe(200);
      const payoutRows = payoutsRes.body.data as Array<{
        id: string;
        status: string;
      }>;
      const pending = payoutRows.find((p) => p.status === 'PENDING');
      expect(pending).toBeDefined();
      const payoutId = pending!.id;

      // After batch, balance is 0 (PAYOUT_ISSUED debited it).
      const balAfterBatch = await request(APP_URL)
        .get('/api/v1/vendor/payouts/balance')
        .set('Authorization', `Bearer ${vendorToken}`);
      expect(BigInt(balAfterBatch.body.availableBalanceMinor as string)).toBe(
        0n,
      );

      // PENDING → ISSUED.
      const issueRes = await request(APP_URL)
        .patch(`/api/v1/admin/payouts/${payoutId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ISSUED' });
      expect(issueRes.status).toBe(200);

      // ISSUED → FAILED.
      const failRes = await request(APP_URL)
        .patch(`/api/v1/admin/payouts/${payoutId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'FAILED', failureReason: 'Bank account closed' });
      expect(failRes.status).toBe(200);
      expect(failRes.body.ok).toBe(true);

      // Balance should be restored to positive by PAYOUT_REVERSED.
      const balAfterFail = await request(APP_URL)
        .get('/api/v1/vendor/payouts/balance')
        .set('Authorization', `Bearer ${vendorToken}`);
      expect(balAfterFail.status).toBe(200);
      expect(
        BigInt(balAfterFail.body.availableBalanceMinor as string),
      ).toBeGreaterThan(0n);

      // Ledger must contain a PAYOUT_REVERSED entry.
      const ledger = await request(APP_URL)
        .get('/api/v1/vendor/payouts/ledger')
        .set('Authorization', `Bearer ${vendorToken}`);
      expect(ledger.status).toBe(200);
      const entries = ledger.body.data as Array<{ type: string }>;
      expect(entries.some((e) => e.type === 'PAYOUT_REVERSED')).toBe(true);
    }, 180000);
  });

  // ---------------------------------------------------------------------------
  // EC-4: Cycle idempotency — same cycleKey twice returns the same batchId
  // ---------------------------------------------------------------------------
  it('should return the same batchId when the same cycleKey is posted twice (idempotency)', async () => {
    const idempCycleKey = `${uniqueYear}-W06`;

    const first = await request(APP_URL)
      .post('/api/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cycleKey: idempCycleKey });
    expect(first.status).toBe(200);
    const firstBatchId = first.body.batchId as string;
    expect(firstBatchId).toBeTruthy();

    const second = await request(APP_URL)
      .post('/api/v1/admin/payouts/batches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ cycleKey: idempCycleKey });
    expect(second.status).toBe(200);
    const secondBatchId = second.body.batchId as string;

    expect(secondBatchId).toBe(firstBatchId);
  }, 30000);

  // ---------------------------------------------------------------------------
  // EC-5: Admin adjustment — memo required, amountMinor='0' rejected
  // ---------------------------------------------------------------------------
  describe('EC-5: admin adjustment validation', () => {
    let adjustVendorId = '';

    beforeAll(async () => {
      const suffix = `${edgeTs}-ec5`;
      const signup = await vendorSignup(suffix);
      adjustVendorId = signup.vendorId;
      // No need to fully KYC-approve — adjustments don't require ACTIVE status.
    }, 60000);

    it('should create an adjustment when memo is provided (201)', async () => {
      const res = await request(APP_URL)
        .post(`/api/v1/admin/vendors/${adjustVendorId}/ledger/adjustments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amountMinor: '500', memo: 'Test bonus credit' });
      expect(res.status).toBe(201);
    }, 30000);

    it('should reject an adjustment with missing memo (422)', async () => {
      const res = await request(APP_URL)
        .post(`/api/v1/admin/vendors/${adjustVendorId}/ledger/adjustments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amountMinor: '500' });
      expect(res.status).toBe(422);
    }, 30000);

    it("should reject an adjustment with amountMinor='0' (422)", async () => {
      const res = await request(APP_URL)
        .post(`/api/v1/admin/vendors/${adjustVendorId}/ledger/adjustments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amountMinor: '0', memo: 'Zero amount should be rejected' });
      expect(res.status).toBe(422);
    }, 30000);
  });

  // ---------------------------------------------------------------------------
  // EC-6: Vendor cannot access another vendor's payout detail (403)
  // ---------------------------------------------------------------------------
  describe('EC-6: vendor B cannot read vendor A payout (403)', () => {
    let vendorAToken = '';
    let vendorAId = '';
    let vendorBToken = '';
    let vendorBId = '';
    const ec6CycleKey = `${uniqueYear}-W07`;

    beforeAll(async () => {
      await setHoldDaysZero(adminToken);

      // Vendor A — fully approved so earnings sweep into a payout.
      const sigA = await vendorSignup(`${edgeTs}-ec6a`);
      vendorAId = sigA.vendorId;
      await approveVendorFully(adminToken, sigA.vendorToken, vendorAId);
      const reA = await request(APP_URL)
        .post('/api/v1/auth/email/login')
        .send({ email: sigA.vendorEmail, password: 'Pass1234!' });
      vendorAToken = reA.body.token as string;

      // Vendor B — fully approved (needs vendor role for the request to pass guards).
      const sigB = await vendorSignup(`${edgeTs}-ec6b`);
      vendorBId = sigB.vendorId;
      await approveVendorFully(adminToken, sigB.vendorToken, vendorBId);
      const reB = await request(APP_URL)
        .post('/api/v1/auth/email/login')
        .send({ email: sigB.vendorEmail, password: 'Pass1234!' });
      vendorBToken = reB.body.token as string;

      void vendorBId; // suppress unused-variable lint warning
    }, 300000);

    it('should return 403 when vendor B reads vendor A payout detail', async () => {
      // Give vendor A a delivered order so a payout can be created.
      await seedDeliveredSubOrder(adminToken, vendorAToken, vendorAId, '6000');

      // Trigger a batch so vendor A has a payout row.
      const batchRes = await request(APP_URL)
        .post('/api/v1/admin/payouts/batches')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ cycleKey: ec6CycleKey });
      expect(batchRes.status).toBe(200);

      // Find vendor A's payout.
      const payoutsRes = await request(APP_URL)
        .get(
          `/api/v1/admin/payouts?vendorId=${vendorAId}&cycleKey=${ec6CycleKey}`,
        )
        .set('Authorization', `Bearer ${adminToken}`);
      expect(payoutsRes.status).toBe(200);
      const rows = payoutsRes.body.data as Array<{ id: string }>;
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const payoutIdA = rows[0].id;

      // Vendor B attempts to read vendor A's payout — expect 403.
      const res = await request(APP_URL)
        .get(`/api/v1/vendor/payouts/${payoutIdA}`)
        .set('Authorization', `Bearer ${vendorBToken}`);
      expect(res.status).toBe(403);
    }, 180000);
  });

  // ---------------------------------------------------------------------------
  // EC-7: Vendor calling admin endpoint returns 403
  // ---------------------------------------------------------------------------
  describe('EC-7: vendor token is rejected by admin endpoints (403)', () => {
    let vendorToken = '';

    beforeAll(async () => {
      const sig = await vendorSignup(`${edgeTs}-ec7`);
      // Just login — no need to fully KYC-approve for this test.
      vendorToken = sig.vendorToken;
    }, 60000);

    it('should return 403 when a vendor token is used to call admin batches endpoint', async () => {
      const res = await request(APP_URL)
        .get('/api/v1/admin/payouts/batches')
        .set('Authorization', `Bearer ${vendorToken}`);
      expect(res.status).toBe(403);
    }, 30000);
  });
});
