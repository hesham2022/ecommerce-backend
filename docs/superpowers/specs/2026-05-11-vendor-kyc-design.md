# Vendor KYC — Design Spec

**Sub-phase 10b** of the multi-vendor e-commerce roadmap. Document-based KYC review gating vendor activation, with per-document statuses, append-only re-submission history, and a soft-expiry warning model.

## Goals

- Vendors can upload KYC documents (commercial registration, tax certificate, IBAN proof, owner ID) with structured metadata.
- Admins can review each document independently — approve or reject with a reason.
- An aggregate `kycStatus` is automatically recomputed from per-doc statuses and surfaced on the vendor entity.
- The existing `VendorsService.approve(vendorId)` path is gated on `kycStatus === APPROVED` — admin cannot flip a vendor to `VendorStatus.ACTIVE` until KYC is complete.
- Document re-submission preserves an audit trail via `superseded_at`; the same `(vendor, type)` can have many historical rows but at most one current row.
- Document expiry is tracked in the `details` jsonb but is **not** auto-enforced — surfaced as a warning in the responses for both vendor and admin.

## Out of scope (deferred phases)

- **Per-region required document sets** — `KYC_REQUIRED_TYPES` is a single hard-coded array. Region-specific requirements can be added later by parameterising the rollup function (which already takes `requiredTypes` as input).
- **Auto-expiry / hard-expiry enforcement** — no scheduled job flips status when a doc expires. The `expiryDate` in `details` is presentational only.
- **Field-level encryption for PII** — the codebase has no existing encryption pattern; KYC data inherits the same row-level access control (admin role guard + vendor-owns-own-data). Masking sensitive fields in responses can be a later polish.
- **Document-type-specific validation rules** (e.g., IBAN checksum, CR-number regex per country). Done at the API DTO layer if needed, not at the model layer.
- **Vendor staff sub-roles** — KYC is managed by the calling vendor user, not delegated to sub-users.

## Data model

### `kyc_document` (new table)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | uuid | PK | App-generated uuidv7 |
| `vendor_id` | uuid | FK `vendor.id` ON DELETE CASCADE NOT NULL | |
| `type` | enum `kyc_document_type_enum` | NOT NULL | `COMMERCIAL_REGISTRATION`, `TAX_CERTIFICATE`, `IBAN_DOCUMENT`, `OWNER_ID` |
| `file_id` | uuid | FK `file.id` ON DELETE RESTRICT NOT NULL | Reuses existing `files` module |
| `status` | enum `kyc_document_status_enum` | NOT NULL DEFAULT `'PENDING'` | `PENDING`, `APPROVED`, `REJECTED` |
| `details` | jsonb | NOT NULL DEFAULT `'{}'::jsonb` | Per-type structured fields (see below) |
| `reject_reason` | text | NULL | Required when `status = REJECTED`, enforced at app layer |
| `superseded_at` | timestamptz | NULL | Set when a newer doc of the same type is uploaded; the row becomes historical |
| `submitted_at` | timestamptz | NOT NULL DEFAULT now() | Vendor's upload time |
| `reviewed_at` | timestamptz | NULL | Set when status transitions to APPROVED or REJECTED |
| `reviewed_by_user_id` | int | FK `user.id` ON DELETE SET NULL, NULL | The admin who reviewed |
| `created_at` | timestamptz | NOT NULL DEFAULT now() | |
| `updated_at` | timestamptz | NOT NULL DEFAULT now() | Auto-updated |

**Indices:**
- `idx_kyc_document_vendor_type_supersedes` on `(vendor_id, type, superseded_at)` — supports "latest doc per type per vendor" via `WHERE superseded_at IS NULL`.
- `idx_kyc_document_status` on `(status)` — admin queue.
- **Partial unique:** `uq_kyc_document_current_per_vendor_type` on `(vendor_id, type) WHERE superseded_at IS NULL` — enforces at most one current row per (vendor, type) at the DB level.

### `details` jsonb shape per type

Captured at upload-time by the vendor. Admin can read but not amend (they reject if a field is wrong).

| Type | Required fields | Optional fields |
|---|---|---|
| `COMMERCIAL_REGISTRATION` | `number` (string), `issueDate` (ISO date string) | `expiryDate` (ISO date string) |
| `TAX_CERTIFICATE` | `taxNumber` (string) | `expiryDate` |
| `IBAN_DOCUMENT` | `iban` (string), `bankName` (string) | `accountHolderName` |
| `OWNER_ID` | `nationalId` (string) | `expiryDate` |

App-layer validation (in `UploadKycDocumentDto`) enforces required fields per type and basic shape (string non-empty, ISO-date parseable). No checksum / regex validation — admins are the final gate.

### Existing `vendor` table — new column

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `kyc_status` | enum `kyc_status_enum` | NOT NULL DEFAULT `'NOT_SUBMITTED'` | `NOT_SUBMITTED`, `PENDING_REVIEW`, `APPROVED`, `REJECTED` |

Aggregate KYC state. Recomputed from `kyc_document` rows in the same transaction as every status-changing operation (per-doc upload, per-doc approve, per-doc reject).

## State / rollup rules

### Per-document state machine

```
   (none) ──vendor upload──▶ PENDING ──admin approve──▶ APPROVED
                                │                        │
                                │                        │ (terminal for this row,
                                │                        │  superseded if vendor
                                │                        │  uploads a newer doc)
                                │                        ▼
                                │                       superseded
                                │
                                └──admin reject (+reason)──▶ REJECTED ──vendor uploads new──▶ superseded
                                                                                            (new row, status=PENDING)
```

- `PENDING` is the initial state.
- Once `APPROVED` or `REJECTED`, the row is terminal — the only way to change the picture is for the vendor to upload a new row of the same type. The previous row's `superseded_at` is set in the same transaction.
- `superseded_at` is set on the OLD row at the moment a NEW row of the same `(vendor, type)` is inserted. Both the old row's update and the new row's insert run in one TypeORM transaction.

### Per-document transitions table

| From | To | Actor | Endpoint | Body |
|---|---|---|---|---|
| (none) | `PENDING` | vendor | `POST /v1/vendor/kyc/documents` | `{ type, fileId, details }` |
| `PENDING` | `APPROVED` | admin | `PATCH /v1/admin/kyc/documents/:id` | `{ status: 'APPROVED' }` |
| `PENDING` | `REJECTED` | admin | `PATCH /v1/admin/kyc/documents/:id` | `{ status: 'REJECTED', rejectReason }` |
| `APPROVED` | (superseded) | vendor | `POST /v1/vendor/kyc/documents` | (implicit: uploading a new doc of the same type) |
| `REJECTED` | (superseded) | vendor | `POST /v1/vendor/kyc/documents` | (implicit) |

**Disallowed transitions** (return 422):
- Admin attempting to flip `APPROVED` ↔ `REJECTED` directly (must supersede via a new vendor upload).
- Admin attempting any transition on a `superseded_at IS NOT NULL` row.
- Vendor `PATCH` to an admin endpoint → 403 (existing roles guard handles this).
- Cross-vendor `GET` / `POST` → 404 (don't leak existence).

### Aggregate `kyc_status` rollup

Pure function in `src/kyc/kyc-rollup.ts`:

```ts
export function computeKycStatus(
  requiredTypes: KycDocumentType[],
  currentDocsByType: Map<KycDocumentType, KycDocumentStatus>,
): KycStatus {
  if (requiredTypes.some((t) => !currentDocsByType.has(t))) {
    return KycStatus.NOT_SUBMITTED;
  }
  if ([...currentDocsByType.values()].some((s) => s === KycDocumentStatus.REJECTED)) {
    return KycStatus.REJECTED;
  }
  if ([...currentDocsByType.values()].some((s) => s === KycDocumentStatus.PENDING)) {
    return KycStatus.PENDING_REVIEW;
  }
  return KycStatus.APPROVED;
}
```

Called inside the same transaction whenever:
- A vendor uploads a new document (could shift NOT_SUBMITTED → PENDING_REVIEW or REJECTED → PENDING_REVIEW or APPROVED → PENDING_REVIEW).
- An admin approves a document (could shift PENDING_REVIEW → APPROVED or stay PENDING_REVIEW).
- An admin rejects a document (could shift PENDING_REVIEW → REJECTED).

The new `kyc_status` is written to `vendor.kyc_status` in the same transaction.

### Vendor activation gate

Modify `src/vendors/vendors.service.ts` `approve(vendorId)`:

```ts
async approve(id: string): Promise<Vendor> {
  const v = await this.repo.findById(id);
  // ... existing not-found / not-PENDING checks
  if (v.kycStatus !== KycStatus.APPROVED) {
    throw new UnprocessableEntityException(
      'Vendor cannot be activated until KYC is approved',
    );
  }
  return this.repo.setStatus(id, VendorStatus.ACTIVE);
}
```

The `reject` and `suspend` paths are unchanged — admins can always reject or suspend regardless of KYC.

## Endpoints

### Vendor

JWT-guarded. Ownership: the calling vendor (resolved from JWT via `productsService.getCallingActiveVendor` or equivalent) — the route operates on the caller's own vendor.

```
POST   /v1/vendor/kyc/documents
GET    /v1/vendor/kyc/documents              (current docs only, filtered by superseded_at IS NULL)
GET    /v1/vendor/kyc/documents/history?type=<type>   (full audit trail for one type)
GET    /v1/vendor/kyc/status                 (aggregate + missing/rejected lists)
```

**`POST` body** (`UploadKycDocumentDto`):

```json
{
  "type": "COMMERCIAL_REGISTRATION",
  "fileId": "uuid",
  "details": {
    "number": "1234567890",
    "issueDate": "2024-01-15",
    "expiryDate": "2027-01-14"
  }
}
```

The service validates:
- `fileId` exists in `files`
- All required fields for the given `type` are present in `details`
- ISO-date strings parse as valid dates
- No current PENDING document already exists for `(vendor, type)` — to prevent accidental double-submit. (If an existing current doc is APPROVED or REJECTED, supersede it; if PENDING, return 422 "already pending review".)

Returns `KycDocumentResponseDto`.

**`GET /v1/vendor/kyc/status`** response:

```json
{
  "kycStatus": "PENDING_REVIEW",
  "requiredTypes": ["COMMERCIAL_REGISTRATION", "TAX_CERTIFICATE", "IBAN_DOCUMENT", "OWNER_ID"],
  "submittedTypes": ["COMMERCIAL_REGISTRATION", "TAX_CERTIFICATE", "IBAN_DOCUMENT"],
  "missingTypes": ["OWNER_ID"],
  "rejectedTypes": [],
  "expiringSoon": [
    { "type": "COMMERCIAL_REGISTRATION", "expiryDate": "2026-06-01", "daysUntilExpiry": 22 }
  ],
  "expired": []
}
```

`expiringSoon` includes any current `APPROVED` doc with `details.expiryDate` within 30 days. `expired` includes any current `APPROVED` doc with `details.expiryDate` in the past.

### Admin

JWT-guarded + `@Roles(RoleEnum.admin)`.

```
GET    /v1/admin/kyc/queue?status=PENDING&vendorId=&page=&limit=
GET    /v1/admin/vendors/:vendorId/kyc       (current docs + aggregate status)
PATCH  /v1/admin/kyc/documents/:id           (approve or reject)
```

**`PATCH` body** (`ReviewKycDocumentDto`):

```json
{ "status": "APPROVED" }
```

or

```json
{ "status": "REJECTED", "rejectReason": "Document image is unreadable" }
```

App-layer validation:
- `rejectReason` non-empty when `status = 'REJECTED'`
- The target doc's current `status === 'PENDING'` and `superseded_at IS NULL`. Otherwise 422.

The transition writes:
- `kyc_document.status`, `reviewed_at`, `reviewed_by_user_id`, optionally `reject_reason`
- A new `admin_audit_log` row of type `KYC_DOC_APPROVED` or `KYC_DOC_REJECTED` with `payload: { vendorId, documentId, type, rejectReason? }`
- Recomputed `vendor.kyc_status`

All inside one TypeORM transaction.

## Error handling

All errors return `422 Unprocessable Entity` with structured `{ message }` payloads, except where noted:

| Condition | HTTP | Where |
|---|---|---|
| `fileId` not found | 422 | Vendor `POST` |
| Required `details` fields missing for `type` | 422 | Vendor `POST` |
| Date string in `details` doesn't parse | 422 | Vendor `POST` |
| Current PENDING doc already exists for `(vendor, type)` | 422 | Vendor `POST` |
| Vendor uploading on behalf of another vendor (impossible since route uses calling vendor) | n/a | n/a |
| Admin rejecting without `rejectReason` | 422 | Admin `PATCH` |
| Admin transitioning on superseded or non-PENDING doc | 422 | Admin `PATCH` |
| Vendor or non-admin user hitting admin endpoint | 403 | Admin endpoints (RolesGuard) |
| Admin activating vendor with `kycStatus !== APPROVED` | 422 | Existing `VendorsService.approve` |

## Audit trail

Each admin per-doc transition writes one row to the existing `admin_audit_log` table:

| Field | Value |
|---|---|
| `action` | `KYC_DOC_APPROVED` or `KYC_DOC_REJECTED` |
| `target_type` | `kyc_document` |
| `target_id` | the document UUID |
| `actor_user_id` | the admin user id |
| `payload` | `{ vendorId, documentId, type, rejectReason? }` |

Vendor uploads do not write to `admin_audit_log` (that table is admin-actions-only). The `kyc_document` row itself provides the audit trail for vendor uploads.

## Module / file layout

```
src/kyc/
  domain/
    kyc-document.ts                          # Plain domain class
    kyc-enums.ts                             # KycDocumentType, KycDocumentStatus, KycStatus
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
  kyc-rollup.ts                              # Pure recompute function
  kyc-rollup.spec.ts
  kyc.service.ts
  kyc.service.spec.ts
  vendor-kyc.controller.ts
  admin-kyc.controller.ts
  kyc.module.ts
```

**Modified existing files:**

```
src/vendors/domain/vendor.ts                 # add kycStatus field
src/vendors/infrastructure/persistence/relational/entities/vendor.entity.ts   # add kyc_status column
src/vendors/infrastructure/persistence/relational/mappers/vendor.mapper.ts    # carry kycStatus
src/vendors/vendors.service.ts               # add KYC gate to approve()
src/app.module.ts                            # register KycModule
```

**New migration:**

```
src/database/migrations/1777700000000-CreateKyc.ts
```

## Required constants

```ts
// src/kyc/kyc-rollup.ts
export const KYC_REQUIRED_TYPES: ReadonlyArray<KycDocumentType> = [
  KycDocumentType.COMMERCIAL_REGISTRATION,
  KycDocumentType.TAX_CERTIFICATE,
  KycDocumentType.IBAN_DOCUMENT,
  KycDocumentType.OWNER_ID,
];

export const KYC_EXPIRY_WARNING_DAYS = 30;
```

## Testing strategy

### Unit tests

- **`kyc-rollup.spec.ts`** — pure function with table-driven cases:
  - Empty currents → NOT_SUBMITTED
  - Some required missing → NOT_SUBMITTED
  - All present, all APPROVED → APPROVED
  - All present, one PENDING (rest APPROVED) → PENDING_REVIEW
  - All present, one REJECTED → REJECTED
  - Mix of REJECTED + PENDING → REJECTED (rejection wins)
- **`kyc.service.spec.ts`** — uses an in-memory abstract repo (matching the established pattern):
  - Upload supersedes previous current doc of same type and updates aggregate kycStatus
  - Upload blocks when a current PENDING doc already exists for the same type
  - Upload requires `fileId` to exist
  - Upload validates required `details` fields per type
  - Admin approve transitions PENDING → APPROVED, sets reviewedAt + reviewedBy, recomputes aggregate
  - Admin reject requires `rejectReason`
  - Admin can't transition a superseded or already-decided doc
  - Aggregate rollup invariants (all 4 cases)
  - Vendor activation gate: `VendorsService.approve` throws when `kycStatus !== APPROVED`
- **`vendors.service.spec.ts` (existing, extended)** — one new test covering the KYC gate.

### E2E tests

`test/kyc/kyc.e2e-spec.ts` against the Docker-running app via `request(APP_URL)`:

1. **Happy path full flow:**
   - Vendor signs up (status PENDING, kycStatus NOT_SUBMITTED)
   - Admin tries to activate → 422 (KYC not approved)
   - Vendor uploads 4 required docs → kycStatus becomes PENDING_REVIEW after the last one
   - Admin approves each → after the 4th approval, kycStatus = APPROVED
   - Admin activates vendor → 200, VendorStatus = ACTIVE
2. **Rejection + re-submission:**
   - Vendor uploads → admin rejects one with reason → kycStatus = REJECTED
   - Vendor uploads a new doc of the same type → previous row marked superseded → kycStatus = PENDING_REVIEW
   - Admin approves the new one → kycStatus = APPROVED
3. **History endpoint** shows both old (superseded) and new rows.
4. **Block double-PENDING:** vendor uploads a doc, immediately tries to upload another of the same type → 422.
5. **Required-fields validation:** vendor uploads without `details.number` for CR → 422.
6. **Cross-vendor 404:** vendor 2 tries to GET vendor 1's docs (impossible via the routes, since they use the calling vendor — but verify the document-id route doesn't leak across vendors).
7. **Admin role guard:** vendor hitting admin endpoint → 403.
8. **Audit log:** after approve+reject cycle, admin's audit-log endpoint shows the two `KYC_DOC_*` rows with correct payloads.

## Open follow-ups (deferred)

- **Per-region required-doc sets** — `KYC_REQUIRED_TYPES` becomes a function of `vendor.defaultRegionId`. The rollup function is already parameterised; just need to plumb the lookup.
- **Hard expiry enforcement** — scheduled job (BullMQ cron) that flips per-doc status to `EXPIRED` (new enum value) and aggregate to `PENDING_REVIEW`, blocking new product publishing.
- **Field-level encryption for PII** — IBAN, national ID stored at rest in `details` jsonb. Encrypt with envelope encryption against a KMS or libsodium key.
- **Response masking** — return only last 4 digits of IBAN / national ID in responses unless explicitly requested with a separate "reveal" admin endpoint.
- **Vendor staff sub-roles** — let vendor admins delegate KYC management to a finance role.
- **Document-type-specific validation** — IBAN checksum, country-specific CR-number regexes, OCR-assisted field extraction.
