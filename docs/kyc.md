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
