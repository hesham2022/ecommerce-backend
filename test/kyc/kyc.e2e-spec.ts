import request from 'supertest';
import { ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL } from '../utils/constants';

describe('Vendor KYC (e2e)', () => {
  const ts = Date.now();
  const vendorEmail = `kyc-vendor-${ts}@example.com`;
  const vendorPassword = 'Pass1234!';
  const shopName = `KYC Shop ${ts}`;

  let adminToken = '';
  let vendorToken = '';
  let vendorId = '';

  // Creates a real File row by calling the same presign endpoint the mobile
  // client uses. The KYC service only checks `findById`, not `isConfirmed`,
  // so we do not need to call /confirm. Purpose 'general' is used because the
  // FileUploadDto only accepts 'general' or 'chat-attachment' — there is no
  // dedicated 'kyc' purpose.
  async function createFileFor(token: string): Promise<string> {
    const presign = await request(APP_URL)
      .post('/api/v1/files/presign')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: `kyc-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 6)}.pdf`,
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

  beforeAll(async () => {
    // 1. Admin login.
    const adminLogin = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    adminToken = adminLogin.body.token as string;

    // 2. Vendor signup (creates PENDING vendor with kycStatus=NOT_SUBMITTED).
    const vendorSignup = await request(APP_URL)
      .post('/api/v1/vendor/signup')
      .send({
        email: vendorEmail,
        password: vendorPassword,
        firstName: 'KYC',
        lastName: 'Vendor',
        name: shopName,
      });
    vendorId = vendorSignup.body.id as string;

    // 3. Vendor login.
    const vendorLogin = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: vendorEmail, password: vendorPassword });
    vendorToken = vendorLogin.body.token as string;
  }, 60000);

  it('should block vendor activation while KYC is NOT_SUBMITTED', async () => {
    const res = await request(APP_URL)
      .patch(`/api/v1/admin/vendors/${vendorId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/KYC/i);
  }, 30000);

  it('should let vendor upload 4 docs and walk to APPROVED, then admin activates', async () => {
    // 1. Vendor uploads all 4 required documents.
    const crFileId = await createFileFor(vendorToken);
    const crUpload = await request(APP_URL)
      .post('/api/v1/vendor/kyc/documents')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        type: 'COMMERCIAL_REGISTRATION',
        fileId: crFileId,
        details: { number: 'CR-1', issueDate: '2024-01-01' },
      });
    expect(crUpload.status).toBe(201);
    expect(crUpload.body.status).toBe('PENDING');

    const taxFileId = await createFileFor(vendorToken);
    const taxUpload = await request(APP_URL)
      .post('/api/v1/vendor/kyc/documents')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        type: 'TAX_CERTIFICATE',
        fileId: taxFileId,
        details: { taxNumber: 'TAX-1' },
      });
    expect(taxUpload.status).toBe(201);

    const ibanFileId = await createFileFor(vendorToken);
    const ibanUpload = await request(APP_URL)
      .post('/api/v1/vendor/kyc/documents')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        type: 'IBAN_DOCUMENT',
        fileId: ibanFileId,
        details: {
          iban: 'SA0380000000608010167519',
          bankName: 'BankX',
        },
      });
    expect(ibanUpload.status).toBe(201);

    const ownerFileId = await createFileFor(vendorToken);
    const ownerUpload = await request(APP_URL)
      .post('/api/v1/vendor/kyc/documents')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        type: 'OWNER_ID',
        fileId: ownerFileId,
        details: { nationalId: '1234567890' },
      });
    expect(ownerUpload.status).toBe(201);

    // 2. Vendor inspects aggregate status — all 4 submitted, none missing.
    const statusAfterUpload = await request(APP_URL)
      .get('/api/v1/vendor/kyc/status')
      .set('Authorization', `Bearer ${vendorToken}`);
    expect(statusAfterUpload.status).toBe(200);
    expect(statusAfterUpload.body.kycStatus).toBe('PENDING_REVIEW');
    expect(statusAfterUpload.body.missingTypes).toEqual([]);
    expect(statusAfterUpload.body.submittedTypes.sort()).toEqual(
      [
        'COMMERCIAL_REGISTRATION',
        'IBAN_DOCUMENT',
        'OWNER_ID',
        'TAX_CERTIFICATE',
      ].sort(),
    );

    // 3. Admin pulls the queue scoped to this vendor — expect 4 PENDING entries.
    const queue = await request(APP_URL)
      .get(`/api/v1/admin/kyc/queue?status=PENDING&vendorId=${vendorId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(queue.status).toBe(200);
    const queueData = queue.body.data as Array<{
      id: string;
      type: string;
      status: string;
      vendorId: string;
    }>;
    expect(queueData.length).toBe(4);
    expect(queueData.every((d) => d.vendorId === vendorId)).toBe(true);
    expect(queueData.every((d) => d.status === 'PENDING')).toBe(true);

    // 4. Admin approves each document one by one.
    for (const doc of queueData) {
      const review = await request(APP_URL)
        .patch(`/api/v1/admin/kyc/documents/${doc.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'APPROVED' });
      expect(review.status).toBe(200);
      expect(review.body.status).toBe('APPROVED');
    }

    // 5. Vendor sees aggregate flip to APPROVED.
    const statusAfterReview = await request(APP_URL)
      .get('/api/v1/vendor/kyc/status')
      .set('Authorization', `Bearer ${vendorToken}`);
    expect(statusAfterReview.status).toBe(200);
    expect(statusAfterReview.body.kycStatus).toBe('APPROVED');
    expect(statusAfterReview.body.missingTypes).toEqual([]);
    expect(statusAfterReview.body.rejectedTypes).toEqual([]);

    // 6. Admin can now activate the vendor — gate is open.
    const activate = await request(APP_URL)
      .patch(`/api/v1/admin/vendors/${vendorId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(activate.status).toBe(200);
    expect(activate.body.status).toBe('ACTIVE');
  }, 120000);
});
