# Vendor Payouts

## Overview

Vendor payouts is an event-sourced ledger system that accrues earnings from delivered sub-orders, applies a per-vendor commission, holds for a configurable window, and sweeps available balance into weekly payouts via a scheduled cron. Admin downloads a CSV, uploads to the bank manually, then marks each payout PAID or FAILED.

## Money flow

1. **Earning.** When `SubOrder.fulfillmentStatus` flips to `DELIVERED` (via `FulfillmentService.buyerConfirmDelivery`), an `EARNING` ledger entry is inserted with `available_at = deliveredAt + payout_hold_days` and amount `(subtotal + shipping) - floor(subtotal * commission_rate)`.
2. **Refund clawback.** When a `Return` transitions to `REFUNDED`, a negative `REFUND_CLAWBACK` entry is inserted with `available_at = now()`. The refund amount is allocated proportionally between the original subtotal and shipping portions of the sub-order.
3. **Payout issuance.** Monday 09:00 cron (`@Cron('0 9 * * 1')`) computes the current ISO week key and calls `PayoutService.issuePayoutsForCycle(cycleKey)`. For each vendor with `available_balance >= payout_minimum_amount_minor`, `status = ACTIVE`, `kycStatus = APPROVED`, and an APPROVED `IBAN_DOCUMENT`, the service inserts a `vendor_payout` row (PENDING) plus a negative `PAYOUT_ISSUED` ledger entry sweeping that balance.
4. **CSV download.** Admin pulls `GET /api/v1/admin/payouts/batches/:id/csv`. The CSV is regenerated on-demand from the batch's payouts (no file persistence).
5. **Bank upload (manual).** Admin uploads the CSV to corporate banking, marks each payout `ISSUED` then `PAID` (or `FAILED` with a reason).
6. **Failure.** Marking a payout `FAILED` writes a positive `PAYOUT_REVERSED` ledger entry, restoring the vendor's available balance for the next cycle.

## Tables

- `vendor_ledger_entry` — event-sourced, append-only. Source of truth.
- `vendor_payout` — one row per `(vendor, cycle)`.
- `payout_batch` — one row per cron run.
- `vendor.commission_rate` — per-vendor commission decimal (e.g., `0.1000` = 10%).

## Settings

| Key | Default | Meaning |
|---|---|---|
| `payout_hold_days` | 14 | Days between DELIVERED and available |
| `payout_minimum_amount_minor` | 5000 | Skip payout below this threshold |
| `payout_cycle_cron` | "0 9 * * 1" | Informational; cron is hardcoded in v1 |
| `payout_default_commission_rate` | "0.1000" | Default commission for new vendors |

## API surface

**Vendor (auth: vendor):**
- `GET /api/v1/vendor/payouts/balance`
- `GET /api/v1/vendor/payouts/upcoming`
- `GET /api/v1/vendor/payouts`
- `GET /api/v1/vendor/payouts/:id`
- `GET /api/v1/vendor/payouts/ledger`

**Admin:**
- `GET /api/v1/admin/payouts/batches`
- `GET /api/v1/admin/payouts/batches/:id`
- `GET /api/v1/admin/payouts/batches/:id/csv`
- `POST /api/v1/admin/payouts/batches` — idempotent trigger by `cycleKey`
- `GET /api/v1/admin/payouts`
- `PATCH /api/v1/admin/payouts/:id` — state transitions
- `GET /api/v1/admin/vendors/:vendorId/ledger`
- `POST /api/v1/admin/vendors/:vendorId/ledger/adjustments`
- `PATCH /api/v1/admin/vendors/:vendorId/commission`

## Implementation notes

- **`admin_user_id` traceability.** The `vendor_payout.admin_user_id` column is declared `uuid` but the project's user IDs are integers. The current code does not persist the admin user ID on `vendor_payout` directly; the audit trail lives in `admin_audit_log` (which uses the correct integer column type for `admin_user_id`). A future migration could change the column type.
- **Cron schedule is hardcoded.** `payout_cycle_cron` exists as a setting but is informational only in v1. Changing the cadence requires a deploy. A future enhancement could wire `SchedulerRegistry` for dynamic scheduling.
- **CSV is regenerated on demand.** No file persistence; the `csv_file_id` column was intentionally omitted from `payout_batch` per the design spec.

## Out of scope (v1)

- Automated bank transfer (Stripe Connect, SARIE).
- Notifications on payout events (planned for the next phase).
- Multi-currency vendors.
- COD orders in the ledger.
- Vendor-initiated "withdraw now".
- Automatic retry of FAILED payouts.
- Gateway chargebacks.
