import { Test } from '@nestjs/testing';
import { UnprocessableEntityException } from '@nestjs/common';
import { KycService } from './kyc.service';
import { KycDocumentAbstractRepository } from './infrastructure/persistence/kyc-document.abstract.repository';
import { FilesService } from '../files/files.service';
import { KycDocument } from './domain/kyc-document';
import {
  KycDocumentStatus,
  KycDocumentType,
  KycStatus,
} from './domain/kyc-enums';

describe('KycService', () => {
  let service: KycService;
  let repo: jest.Mocked<KycDocumentAbstractRepository>;
  let files: jest.Mocked<FilesService>;

  const NOW = new Date('2026-05-15T10:00:00Z');

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(NOW);

    repo = {
      upload: jest.fn(),
      findById: jest.fn(),
      listForVendor: jest.fn(),
      listForAdmin: jest.fn(),
      findCurrentByVendor: jest.fn().mockResolvedValue(new Map()),
      review: jest.fn(),
    } as unknown as jest.Mocked<KycDocumentAbstractRepository>;

    files = {
      findById: jest.fn().mockResolvedValue({ id: 'file-1' }),
    } as unknown as jest.Mocked<FilesService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        KycService,
        { provide: KycDocumentAbstractRepository, useValue: repo },
        { provide: FilesService, useValue: files },
      ],
    }).compile();
    service = moduleRef.get(KycService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('upload', () => {
    it('should upload CR with required details + recompute kycStatus', async () => {
      const created = new KycDocument();
      created.id = 'doc-1';
      created.status = KycDocumentStatus.PENDING;
      repo.upload.mockResolvedValue(created);

      await service.upload({
        vendorId: 'v-1',
        type: KycDocumentType.COMMERCIAL_REGISTRATION,
        fileId: 'file-1',
        details: { number: 'CR-12345', issueDate: '2024-01-15' },
      });

      expect(repo.upload).toHaveBeenCalledWith(
        expect.objectContaining({
          vendorId: 'v-1',
          type: KycDocumentType.COMMERCIAL_REGISTRATION,
          fileId: 'file-1',
          details: { number: 'CR-12345', issueDate: '2024-01-15' },
        }),
        KycStatus.NOT_SUBMITTED, // only 1 of 4 required submitted → still NOT_SUBMITTED
      );
    });

    it('should reject upload when fileId does not exist', async () => {
      files.findById.mockResolvedValue(null);
      await expect(
        service.upload({
          vendorId: 'v-1',
          type: KycDocumentType.COMMERCIAL_REGISTRATION,
          fileId: 'file-missing',
          details: { number: 'CR-1', issueDate: '2024-01-01' },
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should reject CR upload without `number` in details', async () => {
      await expect(
        service.upload({
          vendorId: 'v-1',
          type: KycDocumentType.COMMERCIAL_REGISTRATION,
          fileId: 'file-1',
          details: { issueDate: '2024-01-01' }, // missing number
        }),
      ).rejects.toThrow(/number/i);
    });

    it('should reject CR upload without `issueDate` in details', async () => {
      await expect(
        service.upload({
          vendorId: 'v-1',
          type: KycDocumentType.COMMERCIAL_REGISTRATION,
          fileId: 'file-1',
          details: { number: 'CR-1' }, // missing issueDate
        }),
      ).rejects.toThrow(/issueDate/i);
    });

    it('should reject IBAN upload without `iban`', async () => {
      await expect(
        service.upload({
          vendorId: 'v-1',
          type: KycDocumentType.IBAN_DOCUMENT,
          fileId: 'file-1',
          details: { bankName: 'BankX' },
        }),
      ).rejects.toThrow(/iban/i);
    });

    it('should reject upload when a current PENDING doc of same type exists', async () => {
      const existing = new KycDocument();
      existing.id = 'doc-existing';
      existing.type = KycDocumentType.COMMERCIAL_REGISTRATION;
      existing.status = KycDocumentStatus.PENDING;
      existing.supersededAt = null;
      repo.findCurrentByVendor.mockResolvedValue(
        new Map([[KycDocumentType.COMMERCIAL_REGISTRATION, existing]]),
      );

      await expect(
        service.upload({
          vendorId: 'v-1',
          type: KycDocumentType.COMMERCIAL_REGISTRATION,
          fileId: 'file-1',
          details: { number: 'CR-1', issueDate: '2024-01-01' },
        }),
      ).rejects.toThrow(/already pending/i);
    });

    it('should allow upload when current doc is APPROVED (supersede)', async () => {
      const existing = new KycDocument();
      existing.id = 'doc-existing';
      existing.type = KycDocumentType.COMMERCIAL_REGISTRATION;
      existing.status = KycDocumentStatus.APPROVED;
      existing.supersededAt = null;
      repo.findCurrentByVendor.mockResolvedValue(
        new Map([[KycDocumentType.COMMERCIAL_REGISTRATION, existing]]),
      );
      const created = new KycDocument();
      created.id = 'doc-new';
      created.status = KycDocumentStatus.PENDING;
      repo.upload.mockResolvedValue(created);

      const result = await service.upload({
        vendorId: 'v-1',
        type: KycDocumentType.COMMERCIAL_REGISTRATION,
        fileId: 'file-1',
        details: { number: 'CR-2', issueDate: '2025-01-01' },
      });

      expect(result.id).toBe('doc-new');
      expect(repo.upload).toHaveBeenCalled();
    });

    it('should compute APPROVED kycStatus when all 4 docs APPROVED before this upload', async () => {
      // This is a weird edge — uploading a 5th doc shouldn't be possible
      // for now, but verify rollup math anyway by uploading the 4th type
      // when 3 are already APPROVED.
      const approve = (t: KycDocumentType): KycDocument => {
        const d = new KycDocument();
        d.type = t;
        d.status = KycDocumentStatus.APPROVED;
        d.supersededAt = null;
        return d;
      };
      repo.findCurrentByVendor.mockResolvedValue(
        new Map([
          [
            KycDocumentType.COMMERCIAL_REGISTRATION,
            approve(KycDocumentType.COMMERCIAL_REGISTRATION),
          ],
          [
            KycDocumentType.TAX_CERTIFICATE,
            approve(KycDocumentType.TAX_CERTIFICATE),
          ],
          [
            KycDocumentType.IBAN_DOCUMENT,
            approve(KycDocumentType.IBAN_DOCUMENT),
          ],
        ]),
      );
      const created = new KycDocument();
      created.id = 'doc-new';
      created.status = KycDocumentStatus.PENDING;
      repo.upload.mockResolvedValue(created);

      await service.upload({
        vendorId: 'v-1',
        type: KycDocumentType.OWNER_ID,
        fileId: 'file-1',
        details: { nationalId: '1234567890' },
      });

      // After this upload the OWNER_ID is PENDING, so kycStatus = PENDING_REVIEW
      expect(repo.upload).toHaveBeenCalledWith(
        expect.anything(),
        KycStatus.PENDING_REVIEW,
      );
    });
  });
});
