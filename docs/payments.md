# Payments

The platform supports a multi-gateway abstraction (`PaymentProviderInterface`) with Stripe shipped as the first concrete adapter. Tap and HyperPay are planned as additional adapters and require no changes to checkout, orders, or the webhook controller.

## Payment methods

Two `OrderPaymentMethod` values exist on `POST /v1/orders`:

- `COD` — Cash on delivery. Order response is the flat `Order` object. Vendors see the order immediately. `paymentStatus` flips to `COLLECTED` when the buyer confirms delivery via `POST /v1/orders/:id/suborders/:sid/confirm-delivery`. Existing flow, unchanged by phase 9a.
- `CARD` — Tokenised card payment via a configured gateway. Buyers pass `paymentProvider: 'STRIPE'` (or another configured provider). Order response includes a `payment` object with `clientSecret` for SDK confirmation on the client.

## CARD checkout flow

1. Buyer calls `POST /api/v1/orders` with body `{ paymentMethod: 'CARD', paymentProvider: 'STRIPE', address }` and an `Idempotency-Key` header.
2. Server creates the order in `paymentStatus = PENDING`, then calls `PaymentsService.createForOrder`. `PaymentsService` looks up the provider via `PaymentProviderRegistry.get(STRIPE)`, calls `provider.createIntent(...)`, and persists a `payment` row.
3. Response: `Order & { payment: { id, provider, clientSecret, status } }` (200 first call, 200 idempotent replay).
4. Client confirms the PaymentIntent with the Stripe SDK using `clientSecret`.
5. Stripe POSTs to `/api/v1/payments/webhooks/stripe` with a signed payload. The controller verifies the signature via `provider.verifyAndParseWebhook(req.rawBody, signature)`, then `WebhookHandlerService.handle(event, STRIPE)`:
   1. Looks up the payment by `(provider, providerIntentId)`. 404 if missing.
   2. Inserts an audit row in `payment_event` via `recordIfNew`. If a row with the same `(provider, providerEventId)` already exists, the call returns null and the handler bails — this is event-level idempotency.
   3. Updates `payment.status` and `payment.lastError`.
   4. If status is `SUCCEEDED`, calls `OrdersService.markPaid(orderId)` (flips `paymentStatus` to `COLLECTED`).
   5. If status is `FAILED` or `CANCELED`, calls `OrdersService.cancelForFailedPayment(orderId, reason)` — order moves to `paymentStatus = FAILED`, sub-orders still in `AWAITING_CONFIRMATION` move to `CANCELLED`, one `order_event` audit row per cancelled sub-order with `payload.reason`.

## Vendor visibility

Vendors do not see CARD sub-orders until the payment is collected. The repository query filter is `(o.payment_method = 'COD' OR o.payment_status = 'COLLECTED')`. COD orders are always visible. See `isSubOrderVendorVisible` in `src/orders/sub-order-state-machine.ts` and the filtered queries in `src/orders/infrastructure/persistence/relational/repositories/order.repository.ts` (`listSubOrdersForVendor`, `findSubOrderForVendor`).

## Buyer endpoints

- `GET /api/v1/payments/:id` — JWT-guarded buyer poll for current payment status. Owner-only (delegates to `OrdersService.getById` for the ownership check, translates any error to 403 to avoid existence leakage). Returns `PaymentResponseDto` — note that `clientSecret` is **not** in this response; the buyer received it once at checkout.

## Webhook security

- Raw body is required for HMAC verification. `main.ts` uses `NestFactory.create(AppModule, { rawBody: true })` so `req.rawBody: Buffer` is populated for all routes; the webhook controller asserts non-empty.
- The `stripe-signature` header is required. Missing → 400.
- Signature verification errors are logged at `warn` and translated to `400 Invalid signature`. The underlying Stripe error message is **not** exposed to the client.
- Webhook responses are `204 No Content` on success.

## Configuration

Stripe requires three env vars (all optional at boot — the provider is lazy-init):

- `STRIPE_SECRET_KEY` (e.g. `sk_test_...`) — server-side API key
- `STRIPE_WEBHOOK_SECRET` (e.g. `whsec_...`) — for signature verification
- `STRIPE_PUBLISHABLE_KEY` (e.g. `pk_test_...`) — for the frontend; not used by the backend directly

When the keys are absent, `StripeProvider`'s constructor stores the (undefined) config but does **not** throw — the app boots fine in COD-only environments. The first call to `createIntent` or `verifyAndParseWebhook` throws `InternalServerErrorException` with a clear message naming the missing env var.

## Adding a new gateway

1. Implement `PaymentProviderInterface` in `src/payments/providers/<name>.provider.ts`.
2. Register it in `PaymentProviderRegistry` constructor (and `PaymentsModule.providers`).
3. Add a webhook controller (or extend the existing one) that routes to the same `WebhookHandlerService.handle`.
4. Add provider-specific config under `src/payments/config/`.

The orders module stays untouched — checkout passes `paymentProvider` through and the registry resolves at request time.

## Known follow-ups (deferred to phase 9b+)

- **Orphan-order risk**: if Stripe API throws after the order DB-commit, the order exists with no payment row. Recommended fix: catch in `OrdersController.placeOrder`, flip `paymentStatus = FAILED`, persist the failure into the idempotency cache.
- **Race window** in `OrdersRelationalRepository.cancelForFailedPayment`'s read-then-update; tighten to a single `UPDATE ... WHERE` plus `RETURNING` if webhook volume becomes high.
- **No status FSM** in `PaymentRelationalRepository.updateStatus` — a stale late-arriving event with a different `providerEventId` could in theory revert `payment.status` from `SUCCEEDED`.
- **Refunds** (sub-phase 9b), commission engine + vendor wallet (9c), payouts (9d).

## Tests

- Unit: `src/payments/**/*.spec.ts` — 17 test cases across StripeProvider, PaymentsService, WebhookHandlerService.
- E2E: `test/payments/payments.e2e-spec.ts` — full HTTP flow with the Stripe gateway mocked at the `PaymentProviderRegistry` boundary. Covers: CARD checkout → succeeded webhook → COLLECTED + idempotent replay; failed webhook → FAILED + sub-orders CANCELLED; bad signature → 400.
