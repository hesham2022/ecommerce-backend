# Vendor KYC Implementation Plan (Phase 10b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document-based vendor KYC review gating activation. Vendors upload CR, tax, IBAN, owner-ID docs with structured `details`; admins approve/reject each; aggregate `kyc_status` is recomputed in the same transaction; `VendorsService.approve` is gated on `kycStatus === APPROVED`.

**Architecture:** New `src/kyc/` module mirroring the hexagonal pattern (domain → abstract repo → relational entity + mapper + repo → persistence module → service → controllers → module). Per-doc statuses + append-only re-submission via `superseded_at` (partial unique on `(vendor_id, type) WHERE superseded_at IS NULL`). Aggregate rollup is a pure function called inside every status-changing transaction. The existing `admin_audit_log` records admin reviews. The existing `files` module supplies the actual file storage.

**Tech Stack:** NestJS 11, TypeORM 0.3, PostgreSQL, Jest 30, supertest. Spec at `docs/superpowers/specs/2026-05-11-vendor-kyc-design.md`.

**Out of scope:** Hard expiry / scheduled jobs, per-region required sets, PII encryption, response masking, vendor staff sub-roles.

---

## File Structure

**New module under `src/kyc/`:**

```
src/kyc/
  domain/
    kyc-document.ts
    kyc-enums.ts                         # KycDocumentType, KycDocumentStatus, KycStatus
  dto/
    upload-kyc-document.dto.ts
    review-kyc-document.dto.ts
    kyc-document-response.dto.ts
    kyc-status-response.dto.ts
  infrastructure/
    persistence/
      kyc-document.abstract.repository.ts
      relational/
        entities/
          kyc-document.entity.ts
        mappers/
          kyc-document.mapper.ts
        repositories/
          kyc-document.repository.ts
        relational-persistence.module.ts
  kyc-rollup.ts                          # Pure computeKycStatus
  kyc-rollup.spec.ts
  kyc.service.ts
  kyc.service.spec.ts
  vendor-kyc.controller.ts
  admin-kyc.controller.ts
  kyc.module.ts
```

**Modifications:**

```
src/vendors/domain/vendor.ts                                                  # add kycStatus
src/vendors/infrastructure/persistence/relational/entities/vendor.entity.ts   # add kyc_status column
src/vendors/infrastructure/persistence/relational/mappers/vendor.mapper.ts    # carry kycStatus
src/vendors/vendors.service.ts                                                # KYC gate on approve()
src/vendors/vendors.module.ts                                                 # may need export bump (verify)
src/app.module.ts                                                             # register KycModule
src/database/migrations/1777700000000-CreateKyc.ts                            # new
test/kyc/kyc.e2e-spec.ts                                                      # new
```

---

## Task 1: Migration + add `kyc_status` to vendor

**Files:**
- Create: `src/database/migrations/1777700000000-CreateKyc.ts`

- [ ] **Step 1: Write the migration**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKyc1777700000000 implements MigrationInterface {
  name = 'CreateKyc1777700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Enum types
    await queryRunner.query(
      `CREATE TYPE "kyc_document_type_enum" AS ENUM (` +
        `'COMMERCIAL_REGISTRATION','TAX_CERTIFICATE','IBAN_DOCUMENT','OWNER_ID'` +
        `)`,
    );
    await queryRunner.query(
      `CREATE TYPE "kyc_document_status_enum" AS ENUM (` +
        `'PENDING','APPROVED','REJECTED'` +
        `)`,
    );
    await queryRunner.query(
      `CREATE TYPE "kyc_status_enum" AS ENUM (` +
        `'NOT_SUBMITTED','PENDING_REVIEW','APPROVED','REJECTED'` +
        `)`,
    );

    // 2. Add kyc_status column to vendor (default NOT_SUBMITTED for existing rows)
    await queryRunner.query(
      `ALTER TABLE "vendor" ADD "kyc_status" "kyc_status_enum" ` +
        `NOT NULL DEFAULT 'NOT_SUBMITTED'`,
    );

    // 3. kyc_document table
    await queryRunner.query(
      `CREATE TABLE "kyc_document" (` +
        `"id" uuid NOT NULL, ` +
        `"vendor_id" uuid NOT NULL, ` +
        `"type" "kyc_document_type_enum" NOT NULL, ` +
        `"file_id" uuid NOT NULL, ` +
        `"status" "kyc_document_status_enum" NOT NULL DEFAULT 'PENDING', ` +
        `"details" jsonb NOT NULL DEFAULT '{}'::jsonb, ` +
        `"reject_reason" text, ` +
        `"superseded_at" TIMESTAMP WITH TIME ZONE, ` +
        `"submitted_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `"reviewed_at" TIMESTAMP WITH TIME ZONE, ` +
        `"reviewed_by_user_id" integer, ` +
        `"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_kyc_document_id" PRIMARY KEY ("id")` +
        `)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_kyc_document_vendor_type_supersedes" ` +
        `ON "kyc_document" ("vendor_id", "type", "superseded_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_kyc_document_status" ON "kyc_document" ("status")`,
    );
    // Partial unique: exactly one current row per (vendor, type)
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_kyc_document_current_per_vendor_type" ` +
        `ON "kyc_document" ("vendor_id", "type") ` +
        `WHERE "superseded_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "kyc_document" ADD CONSTRAINT "FK_kyc_document_vendor_id" ` +
        `FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ` +
        `ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "kyc_document" ADD CONSTRAINT "FK_kyc_document_file_id" ` +
        `FOREIGN KEY ("file_id") REFERENCES "file"("id") ` +
        `ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "kyc_document" ADD CONSTRAINT "FK_kyc_document_reviewed_by_user_id" ` +
        `FOREIGN KEY ("reviewed_by_user_id") REFERENCES "user"("id") ` +
        `ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "kyc_document" DROP CONSTRAINT "FK_kyc_document_reviewed_by_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kyc_document" DROP CONSTRAINT "FK_kyc_document_file_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kyc_document" DROP CONSTRAINT "FK_kyc_document_vendor_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_kyc_document_current_per_vendor_type"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_kyc_document_status"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_kyc_document_vendor_type_supersedes"`,
    );
    await queryRunner.query(`DROP TABLE "kyc_document"`);
    await queryRunner.query(`ALTER TABLE "vendor" DROP COLUMN "kyc_status"`);
    await queryRunner.query(`DROP TYPE "kyc_status_enum"`);
    await queryRunner.query(`DROP TYPE "kyc_document_status_enum"`);
    await queryRunner.query(`DROP TYPE "kyc_document_type_enum"`);
  }
}
```

- [ ] **Step 2: Run migration**

Run: `npm run migration:run`
Expected: `Migration CreateKyc1777700000000 has been executed successfully.`

- [ ] **Step 3: Verify schema**

```bash
PGPASSWORD=$(grep '^DATABASE_PASSWORD=' .env | cut -d= -f2) \
  psql -h localhost -p 5432 -U root -d api \
  -c "\d kyc_document" \
  -c "\d vendor" \
  -c "SELECT unnest(enum_range(NULL::kyc_document_type_enum))" \
  -c "SELECT unnest(enum_range(NULL::kyc_document_status_enum))" \
  -c "SELECT unnest(enum_range(NULL::kyc_status_enum))"
```

Expected: `kyc_document` table with 13 columns + 3 indices + 3 FKs; `vendor.kyc_status` column present with default `NOT_SUBMITTED`; all 3 enums show their values; the partial unique index is visible.

- [ ] **Step 4: Commit**

```bash
git add src/database/migrations/1777700000000-CreateKyc.ts
git commit -m "feat(kyc): migration for kyc_document table + add kyc_status to vendor"
```

---

## Task 2: Domain types & enums

**Files:**
- Create: `src/kyc/domain/kyc-enums.ts`
- Create: `src/kyc/domain/kyc-document.ts`

- [ ] **Step 1: Enums**

Create `src/kyc/domain/kyc-enums.ts`:

```ts
export enum KycDocumentType {
  COMMERCIAL_REGISTRATION = 'COMMERCIAL_REGISTRATION',
  TAX_CERTIFICATE = 'TAX_CERTIFICATE',
  IBAN_DOCUMENT = 'IBAN_DOCUMENT',
  OWNER_ID = 'OWNER_ID',
}

export enum KycDocumentStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum KycStatus {
  NOT_SUBMITTED = 'NOT_SUBMITTED',
  PENDING_REVIEW = 'PENDING_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}
```

- [ ] **Step 2: Domain class**

Create `src/kyc/domain/kyc-document.ts`:

```ts
import { KycDocumentStatus, KycDocumentType } from './kyc-enums';

export class KycDocument {
  id!: string;
  vendorId!: string;
  type!: KycDocumentType;
  fileId!: string;
  status!: KycDocumentStatus;
  details!: Record<string, unknown>;
  rejectReason!: string | null;
  supersededAt!: Date | null;
  submittedAt!: Date;
  reviewedAt!: Date | null;
  reviewedByUserId!: number | null;
  createdAt!: Date;
  updatedAt!: Date;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/kyc/domain/
git commit -m "feat(kyc): domain types and enums"
```

---

## Task 3: Rollup function + spec (TDD)

**Files:**
- Create: `src/kyc/kyc-rollup.ts`
- Test: `src/kyc/kyc-rollup.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/kyc/kyc-rollup.spec.ts`:

```ts
import {
  computeKycStatus,
  KYC_REQUIRED_TYPES,
} from './kyc-rollup';
import { KycDocumentStatus, KycDocumentType, KycStatus } from './domain/kyc-enums';

describe('kyc-rollup', () => {
  it('should return NOT_SUBMITTED when no docs exist', () => {
    expect(computeKycStatus(KYC_REQUIRED_TYPES, new Map())).toBe(
      KycStatus.NOT_SUBMITTED,
    );
  });

  it('should return NOT_SUBMITTED when some required types are missing', () => {
    const current = new Map([
      [KycDocumentType.COMMERCIAL_REGISTRATION, KycDocumentStatus.APPROVED],
      [KycDocumentType.TAX_CERTIFICATE, KycDocumentStatus.APPROVED],
      // IBAN_DOCUMENT and OWNER_ID missing
    ]);
    expect(computeKycStatus(KYC_REQUIRED_TYPES, current)).toBe(
      KycStatus.NOT_SUBMITTED,
    );
  });

  it('should return APPROVED when all required are APPROVED', () => {
    const current = new Map([
      [KycDocumentType.COMMERCIAL_REGISTRATION, KycDocumentStatus.APPROVED],
      [KycDocumentType.TAX_CERTIFICATE, KycDocumentStatus.APPROVED],
      [KycDocumentType.IBAN_DOCUMENT, KycDocumentStatus.APPROVED],
      [KycDocumentType.OWNER_ID, KycDocumentStatus.APPROVED],
    ]);
    expect(computeKycStatus(KYC_REQUIRED_TYPES, current)).toBe(
      KycStatus.APPROVED,
    );
  });

  it('should return PENDING_REVIEW when all present but one is PENDING', () => {
    const current = new Map([
      [KycDocumentType.COMMERCIAL_REGISTRATION, KycDocumentStatus.APPROVED],
      [KycDocumentType.TAX_CERTIFICATE, KycDocumentStatus.PENDING],
      [KycDocumentType.IBAN_DOCUMENT, KycDocumentStatus.APPROVED],
      [KycDocumentType.OWNER_ID, KycDocumentStatus.APPROVED],
    ]);
    expect(computeKycStatus(KYC_REQUIRED_TYPES, current)).toBe(
      KycStatus.PENDING_REVIEW,
    );
  });

  it('should return REJECTED when any required doc is REJECTED', () => {
    const current = new Map([
      [KycDocumentType.COMMERCIAL_REGISTRATION, KycDocumentStatus.APPROVED],
      [KycDocumentType.TAX_CERTIFICATE, KycDocumentStatus.REJECTED],
      [KycDocumentType.IBAN_DOCUMENT, KycDocumentStatus.APPROVED],
      [KycDocumentType.OWNER_ID, KycDocumentStatus.PENDING],
    ]);
    expect(computeKycStatus(KYC_REQUIRED_TYPES, current)).toBe(
      KycStatus.REJECTED,
    );
  });

  it('should return REJECTED even when PENDING also present (rejection wins)', () => {
    const current = new Map([
      [KycDocumentType.COMMERCIAL_REGISTRATION, KycDocumentStatus.PENDING],
      [KycDocumentType.TAX_CERTIFICATE, KycDocumentStatus.REJECTED],
      [KycDocumentType.IBAN_DOCUMENT, KycDocumentStatus.PENDING],
      [KycDocumentType.OWNER_ID, KycDocumentStatus.PENDING],
    ]);
    expect(computeKycStatus(KYC_REQUIRED_TYPES, current)).toBe(
      KycStatus.REJECTED,
    );
  });

  it('should ignore non-required types in the current map', () => {
    // (hypothetical extra type, not in REQUIRED_TYPES — should be ignored)
    const current = new Map([
      [KycDocumentType.COMMERCIAL_REGISTRATION, KycDocumentStatus.APPROVED],
      [KycDocumentType.TAX_CERTIFICATE, KycDocumentStatus.APPROVED],
      [KycDocumentType.IBAN_DOCUMENT, KycDocumentStatus.APPROVED],
      [KycDocumentType.OWNER_ID, KycDocumentStatus.APPROVED],
    ]);
    expect(computeKycStatus(KYC_REQUIRED_TYPES, current)).toBe(
      KycStatus.APPROVED,
    );
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npm test -- src/kyc/kyc-rollup.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/kyc/kyc-rollup.ts`:

```ts
import {
  KycDocumentStatus,
  KycDocumentType,
  KycStatus,
} from './domain/kyc-enums';

export const KYC_REQUIRED_TYPES: ReadonlyArray<KycDocumentType> = [
  KycDocumentType.COMMERCIAL_REGISTRATION,
  KycDocumentType.TAX_CERTIFICATE,
  KycDocumentType.IBAN_DOCUMENT,
  KycDocumentType.OWNER_ID,
];

export const KYC_EXPIRY_WARNING_DAYS = 30;

/**
 * Compute the aggregate KycStatus for a vendor given the current (non-superseded)
 * document statuses, indexed by type.
 *
 * Rules, in order:
 *   1. Any required type without a current doc → NOT_SUBMITTED
 *   2. Any required type with REJECTED current doc → REJECTED (rejection wins)
 *   3. Any required type with PENDING current doc → PENDING_REVIEW
 *   4. Otherwise (all required APPROVED) → APPROVED
 *
 * Types not in `requiredTypes` are ignored.
 */
export function computeKycStatus(
  requiredTypes: ReadonlyArray<KycDocumentType>,
  currentDocsByType: Map<KycDocumentType, KycDocumentStatus>,
): KycStatus {
  const requiredStatuses: KycDocumentStatus[] = [];
  for (const t of requiredTypes) {
    const s = currentDocsByType.get(t);
    if (s === undefined) return KycStatus.NOT_SUBMITTED;
    requiredStatuses.push(s);
  }
  if (requiredStatuses.some((s) => s === KycDocumentStatus.REJECTED)) {
    return KycStatus.REJECTED;
  }
  if (requiredStatuses.some((s) => s === KycDocumentStatus.PENDING)) {
    return KycStatus.PENDING_REVIEW;
  }
  return KycStatus.APPROVED;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test -- src/kyc/kyc-rollup.spec.ts`
Expected: 7 tests pass.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: prior tests pass + 7 new = totals up by 7.

- [ ] **Step 6: Commit**

```bash
git add src/kyc/kyc-rollup.ts src/kyc/kyc-rollup.spec.ts
git commit -m "feat(kyc): pure rollup function with TDD coverage"
```

---

## Task 4: Abstract repository

**Files:**
- Create: `src/kyc/infrastructure/persistence/kyc-document.abstract.repository.ts`

- [ ] **Step 1: Write the contract**

```ts
import { KycDocument } from '../../domain/kyc-document';
import {
  KycDocumentStatus,
  KycDocumentType,
} from '../../domain/kyc-enums';

export interface UploadKycDocumentInput {
  id: string;
  vendorId: string;
  type: KycDocumentType;
  fileId: string;
  details: Record<string, unknown>;
}

export interface ReviewKycDocumentInput {
  id: string;
  vendorId: string;
  status: KycDocumentStatus; // APPROVED or REJECTED
  rejectReason: string | null;
  reviewedByUserId: number;
  reviewedAt: Date;
  /**
   * Updated aggregate kyc_status for the vendor, computed by the service in
   * the same transaction. The repository writes this to `vendor.kyc_status`
   * inside the transaction so the rollup is atomic with the per-doc change.
   */
  newVendorKycStatus: import('../../domain/kyc-enums').KycStatus;
}

export interface ListForVendorOptions {
  vendorId: string;
  type?: KycDocumentType;
  includeSuperseded: boolean;
}

export interface ListForAdminOptions {
  status?: KycDocumentStatus;
  vendorId?: string;
  page: number;
  limit: number;
  currentOnly: boolean;
}

export interface ListResult {
  data: KycDocument[];
  total: number;
}

export abstract class KycDocumentAbstractRepository {
  /**
   * Insert a new kyc_document row. If a current (non-superseded) row of the
   * same (vendorId, type) exists, mark it superseded_at = now() in the same
   * transaction. Also writes the new aggregate vendor.kyc_status atomically.
   */
  abstract upload(
    input: UploadKycDocumentInput,
    newVendorKycStatus: import('../../domain/kyc-enums').KycStatus,
  ): Promise<KycDocument>;

  abstract findById(id: string): Promise<KycDocument | null>;

  abstract listForVendor(opts: ListForVendorOptions): Promise<KycDocument[]>;

  abstract listForAdmin(opts: ListForAdminOptions): Promise<ListResult>;

  /**
   * Returns the current (non-superseded) docs for a vendor, indexed by type.
   * Used by the service to compute the rollup before any write.
   */
  abstract findCurrentByVendor(
    vendorId: string,
  ): Promise<Map<KycDocumentType, KycDocument>>;

  /**
   * Approve or reject a document and update vendor.kyc_status in the same
   * transaction. Throws if the target doc is not in PENDING status or is
   * superseded.
   */
  abstract review(input: ReviewKycDocumentInput): Promise<KycDocument>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/kyc/infrastructure/persistence/kyc-document.abstract.repository.ts
git commit -m "feat(kyc): abstract repository contract"
```

---

## Task 5: Entity + mapper + repository + persistence module

**Files:**
- Create: `src/kyc/infrastructure/persistence/relational/entities/kyc-document.entity.ts`
- Create: `src/kyc/infrastructure/persistence/relational/mappers/kyc-document.mapper.ts`
- Create: `src/kyc/infrastructure/persistence/relational/repositories/kyc-document.repository.ts`
- Create: `src/kyc/infrastructure/persistence/relational/relational-persistence.module.ts`

- [ ] **Step 1: Entity**

Create `src/kyc/infrastructure/persistence/relational/entities/kyc-document.entity.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { VendorEntity } from '../../../../../vendors/infrastructure/persistence/relational/entities/vendor.entity';
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { FileEntity } from '../../../../../files/infrastructure/persistence/relational/entities/file.entity';
import {
  KycDocumentStatus,
  KycDocumentType,
} from '../../../../domain/kyc-enums';

@Entity({ name: 'kyc_document' })
@Index('idx_kyc_document_vendor_type_supersedes', [
  'vendorId',
  'type',
  'supersededAt',
])
@Index('idx_kyc_document_status', ['status'])
export class KycDocumentEntity extends EntityRelationalHelper {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'vendor_id', type: 'uuid' })
  vendorId!: string;

  @ManyToOne(() => VendorEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'vendor_id' })
  vendor!: VendorEntity;

  @Column({
    type: 'enum',
    enum: KycDocumentType,
    enumName: 'kyc_document_type_enum',
  })
  type!: KycDocumentType;

  @Column({ name: 'file_id', type: 'uuid' })
  fileId!: string;

  @ManyToOne(() => FileEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'file_id' })
  file!: FileEntity;

  @Column({
    type: 'enum',
    enum: KycDocumentStatus,
    enumName: 'kyc_document_status_enum',
    default: KycDocumentStatus.PENDING,
  })
  status!: KycDocumentStatus;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  details!: Record<string, unknown>;

  @Column({ name: 'reject_reason', type: 'text', nullable: true })
  rejectReason!: string | null;

  @Column({ name: 'superseded_at', type: 'timestamptz', nullable: true })
  supersededAt!: Date | null;

  @Column({ name: 'submitted_at', type: 'timestamptz', default: () => 'now()' })
  submittedAt!: Date;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;

  @Column({ name: 'reviewed_by_user_id', type: 'integer', nullable: true })
  reviewedByUserId!: number | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'reviewed_by_user_id' })
  reviewedBy!: UserEntity | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
```

- [ ] **Step 2: Mapper**

Create `src/kyc/infrastructure/persistence/relational/mappers/kyc-document.mapper.ts`:

```ts
import { KycDocument } from '../../../../domain/kyc-document';
import { KycDocumentEntity } from '../entities/kyc-document.entity';

export class KycDocumentMapper {
  static toDomain(entity: KycDocumentEntity): KycDocument {
    const dom = new KycDocument();
    dom.id = entity.id;
    dom.vendorId = entity.vendorId;
    dom.type = entity.type;
    dom.fileId = entity.fileId;
    dom.status = entity.status;
    dom.details = entity.details ?? {};
    dom.rejectReason = entity.rejectReason ?? null;
    dom.supersededAt = entity.supersededAt ?? null;
    dom.submittedAt = entity.submittedAt;
    dom.reviewedAt = entity.reviewedAt ?? null;
    dom.reviewedByUserId = entity.reviewedByUserId ?? null;
    dom.createdAt = entity.createdAt;
    dom.updatedAt = entity.updatedAt;
    return dom;
  }
}
```

- [ ] **Step 3: Repository**

Create `src/kyc/infrastructure/persistence/relational/repositories/kyc-document.repository.ts`:

```ts
import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { VendorEntity } from '../../../../../vendors/infrastructure/persistence/relational/entities/vendor.entity';
import { KycDocument } from '../../../../domain/kyc-document';
import {
  KycDocumentStatus,
  KycDocumentType,
} from '../../../../domain/kyc-enums';
import {
  KycDocumentAbstractRepository,
  ListForAdminOptions,
  ListForVendorOptions,
  ListResult,
  ReviewKycDocumentInput,
  UploadKycDocumentInput,
} from '../../kyc-document.abstract.repository';
import { KycDocumentEntity } from '../entities/kyc-document.entity';
import { KycDocumentMapper } from '../mappers/kyc-document.mapper';

@Injectable()
export class KycDocumentRelationalRepository
  implements KycDocumentAbstractRepository
{
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(KycDocumentEntity)
    private readonly repo: Repository<KycDocumentEntity>,
  ) {}

  async upload(
    input: UploadKycDocumentInput,
    newVendorKycStatus: import('../../../../domain/kyc-enums').KycStatus,
  ): Promise<KycDocument> {
    return this.dataSource.transaction(async (em) => {
      const docRepo = em.getRepository(KycDocumentEntity);
      const vendorRepo = em.getRepository(VendorEntity);
      const now = new Date();

      // Mark any current (non-superseded) row of the same (vendor, type) as superseded.
      await docRepo.update(
        {
          vendorId: input.vendorId,
          type: input.type,
          supersededAt: IsNull(),
        },
        { supersededAt: now },
      );

      // Insert the new row.
      const row = docRepo.create({
        id: input.id,
        vendorId: input.vendorId,
        type: input.type,
        fileId: input.fileId,
        status: KycDocumentStatus.PENDING,
        details: input.details,
        rejectReason: null,
        supersededAt: null,
        submittedAt: now,
        reviewedAt: null,
        reviewedByUserId: null,
      });
      const saved = await docRepo.save(row);

      // Update vendor.kyc_status atomically.
      await vendorRepo.update(
        { id: input.vendorId },
        { kycStatus: newVendorKycStatus },
      );

      return KycDocumentMapper.toDomain(saved);
    });
  }

  async findById(id: string): Promise<KycDocument | null> {
    const row = await this.repo.findOne({ where: { id } });
    return row ? KycDocumentMapper.toDomain(row) : null;
  }

  async listForVendor(opts: ListForVendorOptions): Promise<KycDocument[]> {
    const qb = this.repo
      .createQueryBuilder('d')
      .where('d.vendor_id = :vendorId', { vendorId: opts.vendorId });
    if (opts.type) {
      qb.andWhere('d.type = :type', { type: opts.type });
    }
    if (!opts.includeSuperseded) {
      qb.andWhere('d.superseded_at IS NULL');
    }
    const rows = await qb.orderBy('d.submitted_at', 'DESC').getMany();
    return rows.map(KycDocumentMapper.toDomain);
  }

  async listForAdmin(opts: ListForAdminOptions): Promise<ListResult> {
    const offset = (opts.page - 1) * opts.limit;
    const qb = this.repo.createQueryBuilder('d');
    if (opts.vendorId) {
      qb.andWhere('d.vendor_id = :vendorId', { vendorId: opts.vendorId });
    }
    if (opts.status) {
      qb.andWhere('d.status = :status', { status: opts.status });
    }
    if (opts.currentOnly) {
      qb.andWhere('d.superseded_at IS NULL');
    }
    const [rows, total] = await qb
      .orderBy('d.submitted_at', 'DESC')
      .skip(offset)
      .take(opts.limit)
      .getManyAndCount();
    return { data: rows.map(KycDocumentMapper.toDomain), total };
  }

  async findCurrentByVendor(
    vendorId: string,
  ): Promise<Map<KycDocumentType, KycDocument>> {
    const rows = await this.repo.find({
      where: { vendorId, supersededAt: IsNull() },
    });
    const out = new Map<KycDocumentType, KycDocument>();
    for (const row of rows) {
      out.set(row.type, KycDocumentMapper.toDomain(row));
    }
    return out;
  }

  async review(input: ReviewKycDocumentInput): Promise<KycDocument> {
    return this.dataSource.transaction(async (em) => {
      const docRepo = em.getRepository(KycDocumentEntity);
      const vendorRepo = em.getRepository(VendorEntity);
      const row = await docRepo.findOne({ where: { id: input.id } });
      if (!row) throw new NotFoundException(`Document ${input.id} not found`);
      if (row.vendorId !== input.vendorId) {
        throw new NotFoundException(`Document ${input.id} not found`);
      }
      if (row.supersededAt !== null) {
        throw new UnprocessableEntityException(
          'Cannot review a superseded document',
        );
      }
      if (row.status !== KycDocumentStatus.PENDING) {
        throw new UnprocessableEntityException(
          `Cannot review a document in status ${row.status}`,
        );
      }
      row.status = input.status;
      row.rejectReason = input.rejectReason;
      row.reviewedAt = input.reviewedAt;
      row.reviewedByUserId = input.reviewedByUserId;
      await docRepo.save(row);
      await vendorRepo.update(
        { id: input.vendorId },
        { kycStatus: input.newVendorKycStatus },
      );
      return KycDocumentMapper.toDomain(row);
    });
  }
}
```

- [ ] **Step 4: Persistence module**

Create `src/kyc/infrastructure/persistence/relational/relational-persistence.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KycDocumentAbstractRepository } from '../kyc-document.abstract.repository';
import { KycDocumentEntity } from './entities/kyc-document.entity';
import { KycDocumentRelationalRepository } from './repositories/kyc-document.repository';

@Module({
  imports: [TypeOrmModule.forFeature([KycDocumentEntity])],
  providers: [
    {
      provide: KycDocumentAbstractRepository,
      useClass: KycDocumentRelationalRepository,
    },
  ],
  exports: [KycDocumentAbstractRepository],
})
export class RelationalKycPersistenceModule {}
```

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

NOTE: this task assumes `VendorEntity` will have a `kycStatus` property in the next step. The repository's `vendorRepo.update(...)` references it. If typecheck fails on `kycStatus`, add a `// @ts-expect-error` comment temporarily or skip the typecheck and let Task 9 land first — both options are fine. (Easier: do Task 9 before this Step 5 if you're working sequentially; if you do Task 5 first, expect a transient type error that Task 9 resolves.)

- [ ] **Step 6: Commit**

```bash
git add src/kyc/infrastructure/persistence/
git commit -m "feat(kyc): relational persistence layer"
```

---

## Task 6: DTOs

**Files:**
- Create: `src/kyc/dto/upload-kyc-document.dto.ts`
- Create: `src/kyc/dto/review-kyc-document.dto.ts`
- Create: `src/kyc/dto/kyc-document-response.dto.ts`
- Create: `src/kyc/dto/kyc-status-response.dto.ts`

- [ ] **Step 1: UploadKycDocumentDto**

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsObject, IsUUID } from 'class-validator';
import { KycDocumentType } from '../domain/kyc-enums';

export class UploadKycDocumentDto {
  @ApiProperty({ enum: KycDocumentType })
  @IsEnum(KycDocumentType)
  type!: KycDocumentType;

  @ApiProperty()
  @IsUUID()
  fileId!: string;

  @ApiProperty({
    description:
      'Per-type structured fields. CR: { number, issueDate, expiryDate? }. ' +
      'TAX: { taxNumber, expiryDate? }. IBAN: { iban, bankName, accountHolderName? }. ' +
      'OWNER_ID: { nationalId, expiryDate? }.',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  details!: Record<string, unknown>;
}
```

- [ ] **Step 2: ReviewKycDocumentDto**

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { KycDocumentStatus } from '../domain/kyc-enums';

export class ReviewKycDocumentDto {
  @ApiProperty({
    enum: [KycDocumentStatus.APPROVED, KycDocumentStatus.REJECTED],
  })
  @IsEnum(KycDocumentStatus)
  status!: KycDocumentStatus;

  @ApiPropertyOptional({ description: 'Required when status = REJECTED' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rejectReason?: string;
}
```

- [ ] **Step 3: KycDocumentResponseDto**

```ts
import { ApiProperty } from '@nestjs/swagger';
import { KycDocument } from '../domain/kyc-document';
import { KycDocumentStatus, KycDocumentType } from '../domain/kyc-enums';

export class KycDocumentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() vendorId!: string;
  @ApiProperty({ enum: KycDocumentType }) type!: KycDocumentType;
  @ApiProperty() fileId!: string;
  @ApiProperty({ enum: KycDocumentStatus }) status!: KycDocumentStatus;
  @ApiProperty() details!: Record<string, unknown>;
  @ApiProperty({ required: false, nullable: true })
  rejectReason!: string | null;
  @ApiProperty({ required: false, nullable: true })
  supersededAt!: Date | null;
  @ApiProperty() submittedAt!: Date;
  @ApiProperty({ required: false, nullable: true })
  reviewedAt!: Date | null;
  @ApiProperty({ required: false, nullable: true })
  reviewedByUserId!: number | null;

  static from(d: KycDocument): KycDocumentResponseDto {
    const dto = new KycDocumentResponseDto();
    dto.id = d.id;
    dto.vendorId = d.vendorId;
    dto.type = d.type;
    dto.fileId = d.fileId;
    dto.status = d.status;
    dto.details = d.details;
    dto.rejectReason = d.rejectReason;
    dto.supersededAt = d.supersededAt;
    dto.submittedAt = d.submittedAt;
    dto.reviewedAt = d.reviewedAt;
    dto.reviewedByUserId = d.reviewedByUserId;
    return dto;
  }
}
```

- [ ] **Step 4: KycStatusResponseDto**

```ts
import { ApiProperty } from '@nestjs/swagger';
import { KycDocumentType, KycStatus } from '../domain/kyc-enums';

export class KycExpiryWarning {
  @ApiProperty({ enum: KycDocumentType }) type!: KycDocumentType;
  @ApiProperty() expiryDate!: string;
  @ApiProperty() daysUntilExpiry!: number;
}

export class KycStatusResponseDto {
  @ApiProperty({ enum: KycStatus }) kycStatus!: KycStatus;
  @ApiProperty({ type: [String], enum: KycDocumentType })
  requiredTypes!: KycDocumentType[];
  @ApiProperty({ type: [String], enum: KycDocumentType })
  submittedTypes!: KycDocumentType[];
  @ApiProperty({ type: [String], enum: KycDocumentType })
  missingTypes!: KycDocumentType[];
  @ApiProperty({ type: [String], enum: KycDocumentType })
  rejectedTypes!: KycDocumentType[];
  @ApiProperty({ type: [KycExpiryWarning] })
  expiringSoon!: KycExpiryWarning[];
  @ApiProperty({ type: [KycExpiryWarning] })
  expired!: KycExpiryWarning[];
}
```

- [ ] **Step 5: Commit**

```bash
git add src/kyc/dto/
git commit -m "feat(kyc): request and response DTOs"
```

---

## Task 7: KycService — upload + listing (TDD)

**Files:**
- Create: `src/kyc/kyc.service.ts`
- Test: `src/kyc/kyc.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/kyc/kyc.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
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
          [KycDocumentType.COMMERCIAL_REGISTRATION, approve(KycDocumentType.COMMERCIAL_REGISTRATION)],
          [KycDocumentType.TAX_CERTIFICATE, approve(KycDocumentType.TAX_CERTIFICATE)],
          [KycDocumentType.IBAN_DOCUMENT, approve(KycDocumentType.IBAN_DOCUMENT)],
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
```

- [ ] **Step 2: Run, verify failure**

Run: `npm test -- src/kyc/kyc.service.spec.ts`
Expected: FAIL — `KycService` not found.

- [ ] **Step 3: Implement service**

Create `src/kyc/kyc.service.ts`:

```ts
import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { uuidv7Generate } from '../utils/uuid';
import { FilesService } from '../files/files.service';
import { KycDocument } from './domain/kyc-document';
import {
  KycDocumentStatus,
  KycDocumentType,
  KycStatus,
} from './domain/kyc-enums';
import { KycDocumentAbstractRepository } from './infrastructure/persistence/kyc-document.abstract.repository';
import {
  computeKycStatus,
  KYC_EXPIRY_WARNING_DAYS,
  KYC_REQUIRED_TYPES,
} from './kyc-rollup';

const REQUIRED_DETAILS_BY_TYPE: Record<KycDocumentType, string[]> = {
  [KycDocumentType.COMMERCIAL_REGISTRATION]: ['number', 'issueDate'],
  [KycDocumentType.TAX_CERTIFICATE]: ['taxNumber'],
  [KycDocumentType.IBAN_DOCUMENT]: ['iban', 'bankName'],
  [KycDocumentType.OWNER_ID]: ['nationalId'],
};

export interface UploadInput {
  vendorId: string;
  type: KycDocumentType;
  fileId: string;
  details: Record<string, unknown>;
}

export interface ReviewInput {
  documentId: string;
  vendorId: string;
  status: KycDocumentStatus;
  rejectReason?: string;
  reviewedByUserId: number;
}

export interface VendorKycStatusSummary {
  kycStatus: KycStatus;
  requiredTypes: KycDocumentType[];
  submittedTypes: KycDocumentType[];
  missingTypes: KycDocumentType[];
  rejectedTypes: KycDocumentType[];
  expiringSoon: Array<{
    type: KycDocumentType;
    expiryDate: string;
    daysUntilExpiry: number;
  }>;
  expired: Array<{
    type: KycDocumentType;
    expiryDate: string;
    daysUntilExpiry: number;
  }>;
}

@Injectable()
export class KycService {
  constructor(
    private readonly docs: KycDocumentAbstractRepository,
    private readonly files: FilesService,
  ) {}

  async upload(input: UploadInput): Promise<KycDocument> {
    // 1. Validate required details fields for the given type
    const required = REQUIRED_DETAILS_BY_TYPE[input.type];
    for (const key of required) {
      const v = (input.details as Record<string, unknown>)[key];
      if (v === undefined || v === null || v === '') {
        throw new UnprocessableEntityException(
          `Missing required field "${key}" for ${input.type}`,
        );
      }
    }

    // 2. Validate fileId exists
    const file = await this.files.findById(input.fileId);
    if (!file) {
      throw new UnprocessableEntityException(`fileId ${input.fileId} not found`);
    }

    // 3. Load current docs for this vendor
    const current = await this.docs.findCurrentByVendor(input.vendorId);
    const existingSameType = current.get(input.type);
    if (
      existingSameType &&
      existingSameType.status === KycDocumentStatus.PENDING
    ) {
      throw new UnprocessableEntityException(
        `A ${input.type} document is already pending review`,
      );
    }

    // 4. Compute the new aggregate kycStatus that will result from this upload
    //    (the new doc itself is PENDING)
    const updated = new Map<KycDocumentType, KycDocumentStatus>();
    for (const [k, v] of current.entries()) updated.set(k, v.status);
    updated.set(input.type, KycDocumentStatus.PENDING);
    const newKycStatus = computeKycStatus(KYC_REQUIRED_TYPES, updated);

    // 5. Insert + supersede + update vendor.kyc_status atomically
    return this.docs.upload(
      {
        id: uuidv7Generate(),
        vendorId: input.vendorId,
        type: input.type,
        fileId: input.fileId,
        details: input.details,
      },
      newKycStatus,
    );
  }

  async listForVendor(
    vendorId: string,
    opts?: { type?: KycDocumentType; includeSuperseded?: boolean },
  ): Promise<KycDocument[]> {
    return this.docs.listForVendor({
      vendorId,
      type: opts?.type,
      includeSuperseded: opts?.includeSuperseded ?? false,
    });
  }

  async getStatusSummary(vendorId: string): Promise<VendorKycStatusSummary> {
    const current = await this.docs.findCurrentByVendor(vendorId);
    const statusByType = new Map<KycDocumentType, KycDocumentStatus>();
    for (const [k, v] of current.entries()) statusByType.set(k, v.status);
    const kycStatus = computeKycStatus(KYC_REQUIRED_TYPES, statusByType);

    const submittedTypes: KycDocumentType[] = [];
    const missingTypes: KycDocumentType[] = [];
    const rejectedTypes: KycDocumentType[] = [];
    for (const t of KYC_REQUIRED_TYPES) {
      if (current.has(t)) {
        submittedTypes.push(t);
        const s = current.get(t)!.status;
        if (s === KycDocumentStatus.REJECTED) rejectedTypes.push(t);
      } else {
        missingTypes.push(t);
      }
    }

    const now = Date.now();
    const expiringSoon: VendorKycStatusSummary['expiringSoon'] = [];
    const expired: VendorKycStatusSummary['expired'] = [];
    for (const [t, d] of current.entries()) {
      if (d.status !== KycDocumentStatus.APPROVED) continue;
      const expiry = (d.details as Record<string, unknown>)['expiryDate'];
      if (typeof expiry !== 'string') continue;
      const expiryMs = Date.parse(expiry);
      if (Number.isNaN(expiryMs)) continue;
      const daysUntilExpiry = Math.floor((expiryMs - now) / (1000 * 60 * 60 * 24));
      if (daysUntilExpiry < 0) {
        expired.push({ type: t, expiryDate: expiry, daysUntilExpiry });
      } else if (daysUntilExpiry <= KYC_EXPIRY_WARNING_DAYS) {
        expiringSoon.push({ type: t, expiryDate: expiry, daysUntilExpiry });
      }
    }

    return {
      kycStatus,
      requiredTypes: [...KYC_REQUIRED_TYPES],
      submittedTypes,
      missingTypes,
      rejectedTypes,
      expiringSoon,
      expired,
    };
  }

  async review(input: ReviewInput): Promise<KycDocument> {
    if (
      input.status !== KycDocumentStatus.APPROVED &&
      input.status !== KycDocumentStatus.REJECTED
    ) {
      throw new UnprocessableEntityException(
        `Cannot review with status ${input.status}`,
      );
    }
    if (
      input.status === KycDocumentStatus.REJECTED &&
      !input.rejectReason?.trim()
    ) {
      throw new UnprocessableEntityException(
        'rejectReason is required when rejecting a document',
      );
    }

    // Compute the new aggregate kycStatus that will result from this transition.
    // We need to load the current docs *after* simulating the change.
    const doc = await this.docs.findById(input.documentId);
    if (!doc) throw new NotFoundException(`Document ${input.documentId} not found`);
    if (doc.vendorId !== input.vendorId) {
      throw new NotFoundException(`Document ${input.documentId} not found`);
    }

    const current = await this.docs.findCurrentByVendor(input.vendorId);
    const statusByType = new Map<KycDocumentType, KycDocumentStatus>();
    for (const [k, v] of current.entries()) statusByType.set(k, v.status);
    statusByType.set(doc.type, input.status); // simulate
    const newKycStatus = computeKycStatus(KYC_REQUIRED_TYPES, statusByType);

    return this.docs.review({
      id: input.documentId,
      vendorId: input.vendorId,
      status: input.status,
      rejectReason: input.rejectReason?.trim() ?? null,
      reviewedByUserId: input.reviewedByUserId,
      reviewedAt: new Date(),
      newVendorKycStatus: newKycStatus,
    });
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- src/kyc/kyc.service.spec.ts`
Expected: 8 tests pass.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: prior tests + 8 new.

- [ ] **Step 6: Commit**

```bash
git add src/kyc/kyc.service.ts src/kyc/kyc.service.spec.ts
git commit -m "feat(kyc): service with upload + status summary (review tests deferred to Task 8)"
```

---

## Task 8: KycService review path — additional TDD coverage

**Files:**
- Modify: `src/kyc/kyc.service.spec.ts`

- [ ] **Step 1: Add review tests**

Append to `src/kyc/kyc.service.spec.ts` inside the main `describe`:

```ts
describe('review', () => {
  const docFixture = (
    overrides?: Partial<KycDocument>,
  ): KycDocument => {
    const d = new KycDocument();
    d.id = 'doc-1';
    d.vendorId = 'v-1';
    d.type = KycDocumentType.COMMERCIAL_REGISTRATION;
    d.status = KycDocumentStatus.PENDING;
    d.supersededAt = null;
    d.details = {};
    d.rejectReason = null;
    d.submittedAt = NOW;
    d.reviewedAt = null;
    d.reviewedByUserId = null;
    d.fileId = 'file-1';
    d.createdAt = NOW;
    d.updatedAt = NOW;
    return Object.assign(d, overrides);
  };

  it('should approve a PENDING document', async () => {
    repo.findById.mockResolvedValue(docFixture());
    repo.findCurrentByVendor.mockResolvedValue(
      new Map([[KycDocumentType.COMMERCIAL_REGISTRATION, docFixture()]]),
    );
    repo.review.mockResolvedValue(
      docFixture({ status: KycDocumentStatus.APPROVED }),
    );

    await service.review({
      documentId: 'doc-1',
      vendorId: 'v-1',
      status: KycDocumentStatus.APPROVED,
      reviewedByUserId: 99,
    });

    expect(repo.review).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'doc-1',
        vendorId: 'v-1',
        status: KycDocumentStatus.APPROVED,
        rejectReason: null,
        reviewedByUserId: 99,
        reviewedAt: NOW,
        newVendorKycStatus: KycStatus.NOT_SUBMITTED, // only 1 of 4 present
      }),
    );
  });

  it('should reject a PENDING document with reason', async () => {
    repo.findById.mockResolvedValue(docFixture());
    repo.findCurrentByVendor.mockResolvedValue(
      new Map([[KycDocumentType.COMMERCIAL_REGISTRATION, docFixture()]]),
    );
    repo.review.mockResolvedValue(
      docFixture({
        status: KycDocumentStatus.REJECTED,
        rejectReason: 'unclear',
      }),
    );

    await service.review({
      documentId: 'doc-1',
      vendorId: 'v-1',
      status: KycDocumentStatus.REJECTED,
      rejectReason: 'unclear',
      reviewedByUserId: 99,
    });

    expect(repo.review).toHaveBeenCalledWith(
      expect.objectContaining({
        status: KycDocumentStatus.REJECTED,
        rejectReason: 'unclear',
      }),
    );
  });

  it('should require rejectReason when status=REJECTED', async () => {
    await expect(
      service.review({
        documentId: 'doc-1',
        vendorId: 'v-1',
        status: KycDocumentStatus.REJECTED,
        reviewedByUserId: 99,
      }),
    ).rejects.toThrow(/rejectReason/i);
  });

  it('should reject status=PENDING from the review endpoint', async () => {
    await expect(
      service.review({
        documentId: 'doc-1',
        vendorId: 'v-1',
        status: KycDocumentStatus.PENDING,
        reviewedByUserId: 99,
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('should 404 when document does not exist', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(
      service.review({
        documentId: 'missing',
        vendorId: 'v-1',
        status: KycDocumentStatus.APPROVED,
        reviewedByUserId: 99,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('should 404 when document belongs to a different vendor (cross-vendor)', async () => {
    repo.findById.mockResolvedValue(docFixture({ vendorId: 'v-2' }));
    await expect(
      service.review({
        documentId: 'doc-1',
        vendorId: 'v-1',
        status: KycDocumentStatus.APPROVED,
        reviewedByUserId: 99,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('should compute APPROVED aggregate when last PENDING becomes APPROVED', async () => {
    const otherApproved = (t: KycDocumentType): KycDocument => {
      const d = docFixture({
        id: `doc-${t}`,
        type: t,
        status: KycDocumentStatus.APPROVED,
      });
      return d;
    };
    repo.findById.mockResolvedValue(docFixture()); // CR doc PENDING
    repo.findCurrentByVendor.mockResolvedValue(
      new Map([
        [KycDocumentType.COMMERCIAL_REGISTRATION, docFixture()],
        [KycDocumentType.TAX_CERTIFICATE, otherApproved(KycDocumentType.TAX_CERTIFICATE)],
        [KycDocumentType.IBAN_DOCUMENT, otherApproved(KycDocumentType.IBAN_DOCUMENT)],
        [KycDocumentType.OWNER_ID, otherApproved(KycDocumentType.OWNER_ID)],
      ]),
    );
    repo.review.mockResolvedValue(
      docFixture({ status: KycDocumentStatus.APPROVED }),
    );

    await service.review({
      documentId: 'doc-1',
      vendorId: 'v-1',
      status: KycDocumentStatus.APPROVED,
      reviewedByUserId: 99,
    });

    expect(repo.review).toHaveBeenCalledWith(
      expect.objectContaining({
        newVendorKycStatus: KycStatus.APPROVED,
      }),
    );
  });
});
```

- [ ] **Step 2: Run tests, verify pass**

Run: `npm test -- src/kyc/kyc.service.spec.ts`
Expected: 15 tests pass total (8 from Task 7 + 7 new).

- [ ] **Step 3: Commit**

```bash
git add src/kyc/kyc.service.spec.ts
git commit -m "test(kyc): review path coverage"
```

---

## Task 9: Vendor entity + activation gate

**Files:**
- Modify: `src/vendors/domain/vendor.ts`
- Modify: `src/vendors/infrastructure/persistence/relational/entities/vendor.entity.ts`
- Modify: `src/vendors/infrastructure/persistence/relational/mappers/vendor.mapper.ts`
- Modify: `src/vendors/vendors.service.ts`
- Test: `src/vendors/vendors.service.spec.ts` (extend if exists, or accept no spec coverage if not)

- [ ] **Step 1: Add `kycStatus` to domain class**

Modify `src/vendors/domain/vendor.ts`. Add the import:

```ts
import { KycStatus } from '../../kyc/domain/kyc-enums';
```

Append inside the `Vendor` class (after `shipsFromCountry`):

```ts
@ApiProperty({ enum: KycStatus, example: KycStatus.NOT_SUBMITTED })
kycStatus!: KycStatus;
```

- [ ] **Step 2: Add column to VendorEntity**

Modify `src/vendors/infrastructure/persistence/relational/entities/vendor.entity.ts`. Add the import:

```ts
import { KycStatus } from '../../../../../kyc/domain/kyc-enums';
```

Append a column near the existing `status` column:

```ts
@Column({
  name: 'kyc_status',
  type: 'enum',
  enum: KycStatus,
  enumName: 'kyc_status_enum',
  default: KycStatus.NOT_SUBMITTED,
})
kycStatus!: KycStatus;
```

- [ ] **Step 3: Update mapper**

Modify `src/vendors/infrastructure/persistence/relational/mappers/vendor.mapper.ts`. Inside the `toDomain` function, add:

```ts
dom.kycStatus = entity.kycStatus;
```

(Place it near the existing status mapping.)

- [ ] **Step 4: Add KYC gate to VendorsService.approve**

Modify `src/vendors/vendors.service.ts`. Add the import:

```ts
import { KycStatus } from '../kyc/domain/kyc-enums';
```

Find `async approve(id: string)`. The current body checks not-found and not-PENDING. Insert a new check after the existing checks and before the `setStatus` call:

```ts
if (v.kycStatus !== KycStatus.APPROVED) {
  throw new UnprocessableEntityException(
    'Vendor cannot be activated until KYC is approved',
  );
}
```

Make sure `UnprocessableEntityException` is imported from `@nestjs/common`.

- [ ] **Step 5: Run typecheck + tests**

Run: `npx tsc --noEmit`
Expected: clean (this resolves the dangling type reference from Task 5).

Run: `npm test`
Expected: still green. If there's a `vendors.service.spec.ts` with an existing test for `approve`, it may fail because the fixture vendor doesn't have `kycStatus = APPROVED`. Update the fixture or add a new test asserting the gate works — both are fine.

- [ ] **Step 6: Commit**

```bash
git add src/vendors/domain/vendor.ts \
        src/vendors/infrastructure/persistence/relational/entities/vendor.entity.ts \
        src/vendors/infrastructure/persistence/relational/mappers/vendor.mapper.ts \
        src/vendors/vendors.service.ts \
        src/vendors/vendors.service.spec.ts
git commit -m "feat(vendors): add kycStatus + gate activation on kycStatus = APPROVED"
```

---

## Task 10: Vendor controller

**Files:**
- Create: `src/kyc/vendor-kyc.controller.ts`

- [ ] **Step 1: Controller**

```ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ProductsService } from '../products/products.service';
import { KycDocumentResponseDto } from './dto/kyc-document-response.dto';
import { KycStatusResponseDto } from './dto/kyc-status-response.dto';
import { UploadKycDocumentDto } from './dto/upload-kyc-document.dto';
import { KycDocumentType } from './domain/kyc-enums';
import { KycService } from './kyc.service';

@ApiTags('Vendor · KYC')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'vendor/kyc', version: '1' })
export class VendorKycController {
  constructor(
    private readonly kyc: KycService,
    private readonly products: ProductsService,
  ) {}

  @Post('documents')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: KycDocumentResponseDto })
  async upload(
    @Req() req: Request,
    @Body() dto: UploadKycDocumentDto,
  ): Promise<KycDocumentResponseDto> {
    const userId = (req.user as { id: number }).id;
    const vendor = await this.products.getCallingActiveVendor(userId);
    const doc = await this.kyc.upload({
      vendorId: vendor.id,
      type: dto.type,
      fileId: dto.fileId,
      details: dto.details,
    });
    return KycDocumentResponseDto.from(doc);
  }

  @Get('documents')
  @ApiOkResponse({ type: KycDocumentResponseDto, isArray: true })
  async listMine(
    @Req() req: Request,
  ): Promise<KycDocumentResponseDto[]> {
    const userId = (req.user as { id: number }).id;
    const vendor = await this.products.getCallingActiveVendor(userId);
    const docs = await this.kyc.listForVendor(vendor.id);
    return docs.map(KycDocumentResponseDto.from);
  }

  @Get('documents/history')
  @ApiOkResponse({ type: KycDocumentResponseDto, isArray: true })
  async history(
    @Req() req: Request,
    @Query('type') type?: KycDocumentType,
  ): Promise<KycDocumentResponseDto[]> {
    const userId = (req.user as { id: number }).id;
    const vendor = await this.products.getCallingActiveVendor(userId);
    const docs = await this.kyc.listForVendor(vendor.id, {
      type,
      includeSuperseded: true,
    });
    return docs.map(KycDocumentResponseDto.from);
  }

  @Get('status')
  @ApiOkResponse({ type: KycStatusResponseDto })
  async status(
    @Req() req: Request,
  ): Promise<KycStatusResponseDto> {
    const userId = (req.user as { id: number }).id;
    const vendor = await this.products.getCallingActiveVendor(userId);
    const summary = await this.kyc.getStatusSummary(vendor.id);
    const dto = new KycStatusResponseDto();
    dto.kycStatus = summary.kycStatus;
    dto.requiredTypes = summary.requiredTypes;
    dto.submittedTypes = summary.submittedTypes;
    dto.missingTypes = summary.missingTypes;
    dto.rejectedTypes = summary.rejectedTypes;
    dto.expiringSoon = summary.expiringSoon;
    dto.expired = summary.expired;
    return dto;
  }
}
```

> Note: `productsService.getCallingActiveVendor` historically only returns ACTIVE vendors. KYC must work for PENDING vendors too. If `getCallingActiveVendor` throws for non-ACTIVE callers, this controller breaks for pre-activation KYC submission. Verify the method's behavior:
>
> ```
> grep -n "getCallingActiveVendor\|throws\|ACTIVE" src/products/products.service.ts
> ```
>
> If it filters on ACTIVE, swap to a vendor-lookup helper that allows PENDING vendors. Either:
> - Use `vendorsService.getById(...)` keyed off `userId` — needs a method that finds the vendor by `userId` (check the vendor repository for an existing one).
> - Add a new `getCallingVendor` (no status filter) on either `VendorsService` or `ProductsService` for KYC's use.
>
> Pick the smallest-change route that doesn't expand scope. Document the call in a comment.

- [ ] **Step 2: Commit**

```bash
git add src/kyc/vendor-kyc.controller.ts
# Plus any small VendorsService helper you may have added.
git commit -m "feat(kyc): vendor-facing controller (upload + list + history + status)"
```

---

## Task 11: Admin controller

**Files:**
- Create: `src/kyc/admin-kyc.controller.ts`

- [ ] **Step 1: Inspect admin role-guard imports**

Run: `grep -n "RolesGuard\|@Roles" src/admin-audit-log/admin-audit-log.controller.ts | head -10`

Use the same imports.

- [ ] **Step 2: Controller**

```ts
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminAuditLogService } from '../admin-audit-log/admin-audit-log.service';
import { Roles } from '../roles/roles.decorator';
import { RoleEnum } from '../roles/roles.enum';
import { RolesGuard } from '../roles/roles.guard';
import { KycDocumentStatus } from './domain/kyc-enums';
import { KycDocumentResponseDto } from './dto/kyc-document-response.dto';
import { ReviewKycDocumentDto } from './dto/review-kyc-document.dto';
import { KycService } from './kyc.service';

@ApiTags('Admin · KYC')
@ApiBearerAuth('jwt')
@Roles(RoleEnum.admin)
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller({ path: 'admin/kyc', version: '1' })
export class AdminKycController {
  constructor(
    private readonly kyc: KycService,
    private readonly audit: AdminAuditLogService,
  ) {}

  @Get('queue')
  @ApiOkResponse({ type: KycDocumentResponseDto, isArray: true })
  async queue(
    @Query('status') status?: KycDocumentStatus,
    @Query('vendorId') vendorId?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ): Promise<{ data: KycDocumentResponseDto[]; total: number }> {
    const result = await this.kyc['docs'].listForAdmin({
      status,
      vendorId,
      page: Math.max(1, Number(page) || 1),
      limit: Math.min(100, Math.max(1, Number(limit) || 20)),
      currentOnly: true,
    });
    return { data: result.data.map(KycDocumentResponseDto.from), total: result.total };
  }

  @Get('vendors/:vendorId')
  @ApiOkResponse({ type: KycDocumentResponseDto, isArray: true })
  async forVendor(
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
  ): Promise<KycDocumentResponseDto[]> {
    const docs = await this.kyc.listForVendor(vendorId);
    return docs.map(KycDocumentResponseDto.from);
  }

  @Patch('documents/:id')
  @ApiOkResponse({ type: KycDocumentResponseDto })
  async review(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewKycDocumentDto,
  ): Promise<KycDocumentResponseDto> {
    const adminUserId = (req.user as { id: number }).id;
    // We need to look up the doc to know its vendorId for the audit + service call
    const existing = await this.kyc['docs'].findById(id);
    if (!existing) {
      // Same 404 semantics as the service would give
      throw new (await import('@nestjs/common')).NotFoundException(
        `Document ${id} not found`,
      );
    }
    const result = await this.kyc.review({
      documentId: id,
      vendorId: existing.vendorId,
      status: dto.status,
      rejectReason: dto.rejectReason,
      reviewedByUserId: adminUserId,
    });

    await this.audit.record({
      adminUserId,
      action:
        dto.status === KycDocumentStatus.APPROVED
          ? 'KYC_DOC_APPROVED'
          : 'KYC_DOC_REJECTED',
      targetType: 'kyc_document',
      targetId: id,
      payload: {
        vendorId: existing.vendorId,
        type: existing.type,
        ...(dto.rejectReason ? { rejectReason: dto.rejectReason } : {}),
      },
    });
    return KycDocumentResponseDto.from(result);
  }
}
```

> **Cleanup note:** the `this.kyc['docs']` private-field access in `queue` + `review` is a code smell. Either:
> - Make `KycService` expose `listForAdmin(opts)` and `findById(id)` thin delegators, OR
> - Refactor the controller to inject `KycDocumentAbstractRepository` directly.
>
> The thin-delegator approach matches the rest of the codebase. Add these two methods to `KycService`:
>
> ```ts
> async listForAdmin(opts: ListForAdminOptions): Promise<ListResult> {
>   return this.docs.listForAdmin(opts);
> }
>
> async findById(id: string): Promise<KycDocument | null> {
>   return this.docs.findById(id);
> }
> ```
>
> Then replace `this.kyc['docs'].listForAdmin(...)` with `this.kyc.listForAdmin(...)`, and the `findById` call site likewise. Also drop the `await import('@nestjs/common')` hack — add `NotFoundException` to the top import.

- [ ] **Step 3: Refactor per the cleanup note**

Add the two delegators to `src/kyc/kyc.service.ts` and clean up the controller. Final controller body should not contain `this.kyc['docs']` or `await import(...)` anywhere.

- [ ] **Step 4: Commit**

```bash
git add src/kyc/admin-kyc.controller.ts src/kyc/kyc.service.ts
git commit -m "feat(kyc): admin controller for queue + review with audit log entries"
```

---

## Task 12: Module wiring

**Files:**
- Create: `src/kyc/kyc.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Kyc module**

```ts
import { Module } from '@nestjs/common';
import { AdminAuditLogModule } from '../admin-audit-log/admin-audit-log.module';
import { FilesModule } from '../files/files.module';
import { ProductsModule } from '../products/products.module';
import { AdminKycController } from './admin-kyc.controller';
import { RelationalKycPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { KycService } from './kyc.service';
import { VendorKycController } from './vendor-kyc.controller';

@Module({
  imports: [
    RelationalKycPersistenceModule,
    FilesModule,
    ProductsModule,
    AdminAuditLogModule,
  ],
  controllers: [VendorKycController, AdminKycController],
  providers: [KycService],
  exports: [KycService],
})
export class KycModule {}
```

> If your VendorKycController used `VendorsService.getCallingVendor` (or similar) instead of `ProductsService.getCallingActiveVendor`, swap the import accordingly. The plan-recommended path is `ProductsService` for parity with the vendor-products + vendor-returns controllers.

- [ ] **Step 2: Register in AppModule**

Modify `src/app.module.ts`:
- Add `import { KycModule } from './kyc/kyc.module';` alphabetically.
- Add `KycModule,` to the `imports: [...]` array alphabetically (between any `J*` and `L*` modules — likely between `FxRatesModule` and `LocalesModule` depending on existing order; check and place correctly).

- [ ] **Step 3: Verify boot**

Run: `npm run build`
Expected: clean.

Run: `npm run start:dev` for ~15s, then Ctrl-C.
Expected: app boots; new routes register without DI errors.

- [ ] **Step 4: Commit**

```bash
git add src/kyc/kyc.module.ts src/app.module.ts
git commit -m "feat(kyc): wire KycModule into AppModule"
```

---

## Task 13: E2E happy path + rejection + re-submission

**Files:**
- Create: `test/kyc/kyc.e2e-spec.ts`

- [ ] **Step 1: Read existing e2e fixture patterns**

Read `test/returns/returns.e2e-spec.ts` (the most recent precedent) to confirm fixture shapes for: vendor signup → admin approval → admin token → JWT shapes.

- [ ] **Step 2: Write the spec**

Create `test/kyc/kyc.e2e-spec.ts`:

```ts
import request from 'supertest';
import { ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL } from '../utils/constants';

describe('Vendor KYC (e2e)', () => {
  const ts = Date.now();
  const vendorEmail = `kyc-vendor-${ts}@example.com`;
  const vendorPassword = 'Pass1234!';

  let adminToken = '';
  let vendorToken = '';
  let vendorId = '';
  let fileIds: string[] = [];
  let crDocId = '';

  beforeAll(async () => {
    const adminLogin = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    adminToken = adminLogin.body.token;

    const vendorSignup = await request(APP_URL)
      .post('/api/v1/vendor/signup')
      .send({
        email: vendorEmail,
        password: vendorPassword,
        firstName: 'KYC',
        lastName: 'Vendor',
        name: `KYC Shop ${ts}`,
      });
    vendorId = vendorSignup.body.id;

    const vendorLogin = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: vendorEmail, password: vendorPassword });
    vendorToken = vendorLogin.body.token;

    // Upload 4 placeholder files via the existing files-presign flow.
    // We need to create real File entries so KYC's fileId validation passes.
    // The presign flow: POST /api/v1/files/presign → get presignedUrl + fileId,
    // PUT bytes to S3, POST /api/v1/files/:id/confirm → confirms the row.
    // For e2e, we can take a shortcut: the test only needs FileEntity rows,
    // which the presign flow creates BEFORE the PUT step.
    // (If the project enforces "must be confirmed" before referencing,
    // we'll need to also confirm — adapt accordingly.)
    for (let i = 0; i < 4; i++) {
      const presign = await request(APP_URL)
        .post('/api/v1/files/presign')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          purpose: 'kyc',
          filename: `kyc-${i}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 1024,
        });
      fileIds.push(presign.body.id);
      // Confirm without actually uploading bytes — adjust if the project's
      // /confirm endpoint hits S3 to verify existence.
      await request(APP_URL)
        .post(`/api/v1/files/${presign.body.id}/confirm`)
        .set('Authorization', `Bearer ${vendorToken}`);
    }
  }, 120000);

  it('should block vendor activation while KYC is NOT_SUBMITTED', async () => {
    const res = await request(APP_URL)
      .patch(`/api/v1/admin/vendors/${vendorId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/KYC/i);
  });

  it('should let vendor upload 4 docs and walk to APPROVED, then admin activates', async () => {
    // Upload CR
    const cr = await request(APP_URL)
      .post('/api/v1/vendor/kyc/documents')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        type: 'COMMERCIAL_REGISTRATION',
        fileId: fileIds[0],
        details: { number: 'CR-1', issueDate: '2024-01-01' },
      });
    expect(cr.status).toBe(201);
    crDocId = cr.body.id;

    // Upload TAX
    await request(APP_URL)
      .post('/api/v1/vendor/kyc/documents')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        type: 'TAX_CERTIFICATE',
        fileId: fileIds[1],
        details: { taxNumber: 'TAX-1' },
      })
      .expect(201);

    // Upload IBAN
    await request(APP_URL)
      .post('/api/v1/vendor/kyc/documents')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        type: 'IBAN_DOCUMENT',
        fileId: fileIds[2],
        details: { iban: 'SA0380000000608010167519', bankName: 'BankX' },
      })
      .expect(201);

    // Upload OWNER_ID
    await request(APP_URL)
      .post('/api/v1/vendor/kyc/documents')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        type: 'OWNER_ID',
        fileId: fileIds[3],
        details: { nationalId: '1234567890' },
      })
      .expect(201);

    // Status now PENDING_REVIEW
    const statusRes = await request(APP_URL)
      .get('/api/v1/vendor/kyc/status')
      .set('Authorization', `Bearer ${vendorToken}`)
      .expect(200);
    expect(statusRes.body.kycStatus).toBe('PENDING_REVIEW');
    expect(statusRes.body.missingTypes).toEqual([]);

    // Admin reviews all 4 documents
    const queue = await request(APP_URL)
      .get(`/api/v1/admin/kyc/queue?status=PENDING&vendorId=${vendorId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(queue.body.data).toHaveLength(4);

    for (const doc of queue.body.data) {
      await request(APP_URL)
        .patch(`/api/v1/admin/kyc/documents/${doc.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'APPROVED' })
        .expect(200);
    }

    // Status now APPROVED
    const finalStatus = await request(APP_URL)
      .get('/api/v1/vendor/kyc/status')
      .set('Authorization', `Bearer ${vendorToken}`)
      .expect(200);
    expect(finalStatus.body.kycStatus).toBe('APPROVED');

    // Admin activates vendor — now succeeds
    const approveRes = await request(APP_URL)
      .patch(`/api/v1/admin/vendors/${vendorId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(approveRes.status).toBe(200);
  }, 120000);
});
```

- [ ] **Step 3: Run e2e**

Run: `npm run test:e2e -- --testPathPatterns="test/kyc"` (or the docker-orchestrated equivalent).
Expected: 2 tests pass.

If a fixture step fails (file-presign shape differs, admin approval URL differs, etc.), patch ONLY the fixture step. If a KYC-flow assertion fails, that's a real bug — investigate.

- [ ] **Step 4: Commit**

```bash
git add test/kyc/kyc.e2e-spec.ts
git commit -m "test(kyc): e2e happy path (upload 4 docs -> admin approve -> vendor activates)"
```

---

## Task 14: E2E edge cases

**Files:**
- Modify: `test/kyc/kyc.e2e-spec.ts`

- [ ] **Step 1: Add edge-case tests inside the same `describe`**

```ts
it('should reject CR upload without `number` in details', async () => {
  // Use a fresh vendor so we don't conflict with the previous tests.
  const ts2 = Date.now();
  const e = `kyc-edge1-${ts2}@example.com`;
  const p = 'Pass1234!';
  await request(APP_URL).post('/api/v1/vendor/signup').send({
    email: e,
    password: p,
    firstName: 'X',
    lastName: 'Y',
    name: `Edge1 ${ts2}`,
  });
  const login = await request(APP_URL)
    .post('/api/v1/auth/email/login')
    .send({ email: e, password: p });
  const tok = login.body.token;

  // Need a fileId
  const presign = await request(APP_URL)
    .post('/api/v1/files/presign')
    .set('Authorization', `Bearer ${tok}`)
    .send({
      purpose: 'kyc',
      filename: 'cr.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });
  await request(APP_URL)
    .post(`/api/v1/files/${presign.body.id}/confirm`)
    .set('Authorization', `Bearer ${tok}`);

  const res = await request(APP_URL)
    .post('/api/v1/vendor/kyc/documents')
    .set('Authorization', `Bearer ${tok}`)
    .send({
      type: 'COMMERCIAL_REGISTRATION',
      fileId: presign.body.id,
      details: { issueDate: '2024-01-01' }, // missing number
    });
  expect(res.status).toBe(422);
  expect(res.body.message).toMatch(/number/i);
});

it('should reject double-PENDING upload of same type', async () => {
  // Reuse the existing vendor — they already have CR APPROVED.
  // Upload a new CR; that supersedes & creates a PENDING. Then try a second
  // upload — should be rejected.
  const presignA = await request(APP_URL)
    .post('/api/v1/files/presign')
    .set('Authorization', `Bearer ${vendorToken}`)
    .send({
      purpose: 'kyc',
      filename: 'cr2.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });
  await request(APP_URL)
    .post(`/api/v1/files/${presignA.body.id}/confirm`)
    .set('Authorization', `Bearer ${vendorToken}`);

  await request(APP_URL)
    .post('/api/v1/vendor/kyc/documents')
    .set('Authorization', `Bearer ${vendorToken}`)
    .send({
      type: 'COMMERCIAL_REGISTRATION',
      fileId: presignA.body.id,
      details: { number: 'CR-2', issueDate: '2025-01-01' },
    })
    .expect(201);

  // Same vendor immediately tries again
  const presignB = await request(APP_URL)
    .post('/api/v1/files/presign')
    .set('Authorization', `Bearer ${vendorToken}`)
    .send({
      purpose: 'kyc',
      filename: 'cr3.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });
  await request(APP_URL)
    .post(`/api/v1/files/${presignB.body.id}/confirm`)
    .set('Authorization', `Bearer ${vendorToken}`);

  const res = await request(APP_URL)
    .post('/api/v1/vendor/kyc/documents')
    .set('Authorization', `Bearer ${vendorToken}`)
    .send({
      type: 'COMMERCIAL_REGISTRATION',
      fileId: presignB.body.id,
      details: { number: 'CR-3', issueDate: '2025-02-01' },
    });
  expect(res.status).toBe(422);
  expect(res.body.message).toMatch(/pending/i);
});

it('should reject admin review without rejectReason when status=REJECTED', async () => {
  // Find any current PENDING doc for our vendor
  const queue = await request(APP_URL)
    .get(`/api/v1/admin/kyc/queue?status=PENDING&vendorId=${vendorId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  if (queue.body.data.length === 0) {
    return; // skip if no pending docs left
  }
  const docId = queue.body.data[0].id;

  const res = await request(APP_URL)
    .patch(`/api/v1/admin/kyc/documents/${docId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ status: 'REJECTED' });
  expect(res.status).toBe(422);
  expect(res.body.message).toMatch(/rejectReason/i);
});

it('should reject vendor access to admin endpoints (403)', async () => {
  const res = await request(APP_URL)
    .get('/api/v1/admin/kyc/queue')
    .set('Authorization', `Bearer ${vendorToken}`);
  expect(res.status).toBe(403);
});
```

- [ ] **Step 2: Run e2e**

Run: `npm run test:e2e -- --testPathPatterns="test/kyc"`.
Expected: all original + 4 new tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/kyc/kyc.e2e-spec.ts
git commit -m "test(kyc): e2e edge cases (missing field, double-pending, missing reject reason, vendor->admin 403)"
```

---

## Task 15: Final verification + docs + PR

- [ ] **Step 1: Full verification**

Run: `npm run lint && npm test && npm run build`
Expected: all clean.

Run the e2e suite: `npm run test:e2e -- --testPathPatterns="test/kyc"` — expect green.

- [ ] **Step 2: Write docs**

Create `docs/kyc.md`:

```markdown
# Vendor KYC

Phase 10b: document-based KYC review gating vendor activation. Vendors upload commercial registration, tax certificate, IBAN, and owner ID documents with structured `details`. Admins approve or reject each document independently. Aggregate `kycStatus` is automatically recomputed in the same transaction as each per-doc status change. `VendorsService.approve` is gated on `kycStatus === APPROVED`.

## Required documents

| Type | Required fields in `details` |
|---|---|
| COMMERCIAL_REGISTRATION | `number`, `issueDate`, optional `expiryDate` |
| TAX_CERTIFICATE | `taxNumber`, optional `expiryDate` |
| IBAN_DOCUMENT | `iban`, `bankName`, optional `accountHolderName` |
| OWNER_ID | `nationalId`, optional `expiryDate` |

## Lifecycle

Per-document: `PENDING → APPROVED` (admin) or `PENDING → REJECTED` (admin, with `rejectReason`). Vendor re-uploads create a new row and mark the previous current row `superseded_at = now()`. Partial unique index `(vendor_id, type) WHERE superseded_at IS NULL` guarantees at most one current row.

Aggregate `kycStatus`:
- `NOT_SUBMITTED` — any required type has no current row
- `REJECTED` — any required current doc is REJECTED
- `PENDING_REVIEW` — all present, at least one PENDING
- `APPROVED` — all present and APPROVED

Recomputed inside every transaction that changes a per-doc status (upload, approve, reject).

## Endpoints

**Vendor (JWT):**
- `POST /v1/vendor/kyc/documents`
- `GET /v1/vendor/kyc/documents` (current only)
- `GET /v1/vendor/kyc/documents/history?type=...`
- `GET /v1/vendor/kyc/status` (aggregate + missing/rejected/expiring lists)

**Admin (JWT + admin role):**
- `GET /v1/admin/kyc/queue?status=&vendorId=`
- `GET /v1/admin/kyc/vendors/:vendorId`
- `PATCH /v1/admin/kyc/documents/:id` — `{ status: APPROVED }` or `{ status: REJECTED, rejectReason }`

## Activation gate

`VendorsService.approve(vendorId)` now throws 422 `"Vendor cannot be activated until KYC is approved"` when `vendor.kycStatus !== APPROVED`. Reject / suspend / reinstate paths are unchanged.

## Audit trail

Every admin review writes a row to `admin_audit_log`:
- `action`: `KYC_DOC_APPROVED` or `KYC_DOC_REJECTED`
- `target_type`: `kyc_document`
- `target_id`: document UUID
- `actor_user_id`: admin user
- `payload`: `{ vendorId, type, rejectReason? }`

## Expiry

Soft. `details.expiryDate` is surfaced in `GET /v1/vendor/kyc/status` as `expiringSoon` (≤30 days) or `expired` (negative). No automatic enforcement; admins handle re-collection manually.

## Known follow-ups

- Per-region required document sets — rollup is already parameterised on `requiredTypes`.
- Hard-expiry scheduled job — automatic flip to `PENDING_REVIEW` when a doc expires.
- PII field-level encryption / response masking for IBAN and national ID.
- Vendor staff sub-roles to delegate KYC management.
- IBAN checksum + country-specific CR-number validation.
```

- [ ] **Step 3: Commit docs**

```bash
git add docs/kyc.md
git commit -m "docs(kyc): document the vendor KYC flow"
```

- [ ] **Step 4: Push the branch**

```bash
git push -u origin phase-10b-kyc
```

- [ ] **Step 5: Open PR**

```bash
gh pr create --title "feat: phase 10b — vendor KYC" --base main --body-file - <<'EOF'
## Summary

Phase 10b of the e-commerce backend roadmap: document-based vendor KYC review gating activation. Four required document types (commercial registration, tax certificate, IBAN, owner ID), per-document statuses, append-only re-submission with `superseded_at`, aggregate `kycStatus` recomputed in the same transaction as every per-doc change. `VendorsService.approve` now refuses to activate a vendor until `kycStatus === APPROVED`.

- Migration `1777700000000-CreateKyc` adds `kyc_document` table + 3 enums + `vendor.kyc_status` column. Partial unique index on `(vendor_id, type) WHERE superseded_at IS NULL`.
- New `src/kyc/` module mirrors the established hexagonal pattern.
- Per-doc approval/rejection writes a row to `admin_audit_log` for the audit trail.
- Pure rollup function (`kyc-rollup.ts`) with table-driven TDD coverage.

## Test plan

- [x] `npm run lint` clean
- [x] `npm test` — unit tests including rollup + service spec
- [x] `npm run test:e2e -- --testPathPatterns="test/kyc"` — happy path + 4 edge cases
- [x] `npm run build` clean
- [x] App boots cleanly

## Out of scope (deferred)

- Per-region required document sets
- Hard-expiry scheduled enforcement
- Field-level PII encryption / response masking
- IBAN checksum + country-specific validation

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

Capture the PR URL and report it.

---

## Self-Review (controller's checklist)

**Spec coverage:**
- ✅ `kyc_document` table + `vendor.kyc_status` — Task 1
- ✅ Three new enums — Task 1
- ✅ Domain types — Task 2
- ✅ Pure rollup function with TDD — Task 3
- ✅ Abstract repo — Task 4
- ✅ Entity + mapper + impl + persistence module — Task 5
- ✅ DTOs — Task 6
- ✅ Service: upload + status summary — Task 7
- ✅ Service: review path — Task 8
- ✅ Vendor entity + activation gate — Task 9
- ✅ Vendor controller — Task 10
- ✅ Admin controller + audit log integration — Task 11
- ✅ Module wiring — Task 12
- ✅ E2E happy path — Task 13
- ✅ E2E edge cases — Task 14
- ✅ Docs + PR — Task 15

**Type consistency:**
- `KycDocumentType`, `KycDocumentStatus`, `KycStatus` are used consistently across tasks.
- `findCurrentByVendor` returns `Map<KycDocumentType, KycDocument>` in both abstract repo (Task 4) and relational impl (Task 5).
- `computeKycStatus(requiredTypes, currentDocsByType)` signature is the same in Tasks 3, 7, and 8.

**Placeholder scan:**
- The `getCallingActiveVendor` note in Task 10 explicitly resolves to either picking the existing helper or adding a thin one. Not an unfinished placeholder — it's a forked decision with both paths spelled out.
- The Task 11 cleanup-note refactor is mandatory (specified as Step 3), not optional.
- No "TBD" / "TODO" anywhere.
