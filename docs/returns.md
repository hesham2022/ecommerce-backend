# Returns / RMA

Phase 10a: buyer-initiated, post-delivery returns with a vendor-driven approval state machine, per-item granularity, optional photo evidence, off-platform return shipping, and a logical `REFUNDED` state for COD orders. Real money movement (Stripe refunds) is deferred to phase 9b.

## Lifecycle

`REQUESTED → APPROVED → SHIPPED_BACK → RECEIVED → REFUNDED → CLOSED` is the happy path. `REJECTED` is reachable from `REQUESTED` and from `RECEIVED` (vendor rejects after physical inspection). `CLOSED` and `REJECTED` are terminal.

Buyer triggers: `REQUESTED` (create) and `SHIPPED_BACK` (after vendor approval). All other transitions are vendor-driven.

## Eligibility

A return is eligible if:
- `sub_order.fulfillment_status = 'DELIVERED'`
- `now() <= sub_order.delivered_at + vendor.return_window_days days`
- The cumulative `quantity` across non-rejected RMAs for an `order_item` does not exceed the originally ordered quantity.

## Endpoints

**Buyer:**
- `POST /v1/orders/:orderId/suborders/:subOrderId/returns` — create
- `GET /v1/returns?subOrderId=&status=` — list mine
- `GET /v1/returns/:id` — detail (404 if not owner)
- `PATCH /v1/returns/:id/shipped-back` — confirm shipped, optional `trackingNumber`

**Vendor:**
- `GET /v1/vendor/returns?status=&subOrderId=` — vendor's queue
- `GET /v1/vendor/returns/:id` — detail
- `PATCH /v1/vendor/returns/:id` — transition. Body shape varies by target: `{ status: APPROVED }`, `{ status: REJECTED, rejectReason }`, `{ status: RECEIVED, restock }`, `{ status: REFUNDED }`, `{ status: CLOSED }`.

**Admin:**
- `GET /v1/admin/returns?status=&vendorId=&buyerId=` — read-only moderation list
- `GET /v1/admin/returns/:id` — read-only detail

## Inventory

When the vendor flips to `RECEIVED` with `restock: true`, each `return_item.quantity` is added to its variant's `variant_stock.quantity` inside the same TypeORM transaction that updates the RMA status — atomic restock + status flip via raw SQL `UPDATE variant_stock SET quantity = quantity + $1 WHERE variant_id = $2`. `restock: false` skips the increment.

## Sub-order auto-flip

When all items of a sub-order have CLOSED returns covering the full ordered quantity, the sub-order's `fulfillment_status` flips to `RETURNED` (the existing terminal state). Otherwise it stays `DELIVERED`.

## Audit trail

The existing `order_event` table is reused. The `order_event_type_enum` was extended with seven new values:
`RETURN_REQUESTED`, `RETURN_APPROVED`, `RETURN_REJECTED`, `RETURN_SHIPPED_BACK`, `RETURN_RECEIVED`, `RETURN_REFUNDED`, `RETURN_CLOSED`. The sub-order timeline endpoint at `GET /v1/orders/:id/suborders/:sid/events` shows fulfillment + return events interleaved chronologically with no API changes.

## Refund semantics for COD

In phase 10a, `REFUNDED` is a logical state — backend records the timestamp and amount, no money moves. Vendor and buyer settle off-platform. Phase 9b will plug Stripe refunds into the same transition for CARD orders.

## Open-RMA constraint

At most one non-terminal RMA per `order_item`. Enforced at the application layer in `returns.service.ts` via `sumNonRejectedQuantitiesByOrderItem` — a defence-in-depth partial-unique DB constraint isn't possible because the predicate references another table.

## Known follow-ups

- **CARD refunds** (phase 9b): plug `paymentsService.refundForReturn(...)` into the `REFUNDED` transition for orders where `paymentMethod = CARD`.
- **Auto-CLOSE**: scheduled job to flip `REFUNDED` → `CLOSED` after N days of inactivity.
- **Vendor recalls**: vendor-initiated returns; needs admin moderation if buyer disputes.
- **Partial refunds**: vendor sets `refundAmountMinor` per RMA when keep-and-discount arrangements are needed.
- **Carrier integration** for return shipping labels.
