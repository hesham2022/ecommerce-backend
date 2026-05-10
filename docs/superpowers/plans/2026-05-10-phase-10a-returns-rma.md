# Returns / RMA Implementation Plan (Phase 10a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Buyer-initiated post-delivery returns with a vendor-driven approval state machine, per-item granularity, optional photo evidence, off-platform return shipping, and a logical `REFUNDED` state recording refund obligations (real money movement deferred to phase 9b).

**Architecture:** New `src/returns/` module mirroring the existing hexagonal pattern (domain → abstract repo → relational entities + mappers + repos → persistence module → service → controllers → module). State machine drives transitions; transitions are atomic via TypeORM transactions. The `RECEIVED` + restock transition writes `variant_stock` directly via the returns repository's `EntityManager` to preserve atomicity (cross-domain access is contained inside the transaction boundary). Sub-order `fulfillmentStatus` flips to the existing terminal `RETURNED` state automatically when every item in the sub-order has a CLOSED return covering the full ordered quantity.

**Tech Stack:** NestJS 11, TypeORM 0.3, PostgreSQL, Jest 30, supertest. Spec at `docs/superpowers/specs/2026-05-10-returns-rma-design.md`.

**Out of scope (deferred):** Stripe refunds (phase 9b), partial refund amounts, vendor-initiated recalls, carrier integrations.

---

## File Structure

**New module under `src/returns/`:**

```
src/returns/
  domain/
    return.ts                            # Domain class for return_request
    return-item.ts                       # Domain class for return_item
    return-attachment.ts                 # Domain class for return_attachment
    return-enums.ts                      # ReturnStatus, ReturnReason
  dto/
    create-return.dto.ts                 # buyer POST body
    confirm-shipped-back.dto.ts          # buyer PATCH body
    transition-return.dto.ts             # vendor PATCH body (discriminated)
    return-response.dto.ts               # response shape
  infrastructure/
    persistence/
      return.abstract.repository.ts      # contract
      relational/
        entities/
          return-request.entity.ts
          return-item.entity.ts
          return-attachment.entity.ts
        mappers/
          return.mapper.ts
        repositories/
          return.repository.ts
        relational-persistence.module.ts
  return-state-machine.ts                # pure functions: canBuyerTransition, canVendorTransition, etc.
  return-state-machine.spec.ts
  returns.service.ts                     # orchestrator
  returns.service.spec.ts
  returns.controller.ts                  # buyer
  vendor-returns.controller.ts           # vendor
  admin-returns.controller.ts            # admin
  returns.module.ts
```

**Modifications to existing files:**

```
src/orders/domain/order-enums.ts                 # extend OrderEventType with 7 new values
src/database/migrations/1777600000000-CreateReturns.ts   # new migration (3 tables + 2 enums + 7 enum values)
src/products/infrastructure/persistence/product-variant.abstract.repository.ts   # add `incrementStock` method
src/products/infrastructure/persistence/relational/repositories/product-variant.repository.ts   # implement it
src/app.module.ts                                # register ReturnsModule
test/returns/returns.e2e-spec.ts                 # e2e against Docker app
```

---

## Task 1: Migration & enum extension

**Files:**
- Create: `src/database/migrations/1777600000000-CreateReturns.ts`
- Modify: `src/orders/domain/order-enums.ts`

- [ ] **Step 1: Extend `OrderEventType` enum**

Modify `src/orders/domain/order-enums.ts`. Currently:

```ts
export enum OrderEventType {
  STATUS_CHANGED = 'STATUS_CHANGED',
  PAYMENT_COLLECTED = 'PAYMENT_COLLECTED',
  DELIVERED_BY_BUYER = 'DELIVERED_BY_BUYER',
}
```

Replace with:

```ts
export enum OrderEventType {
  STATUS_CHANGED = 'STATUS_CHANGED',
  PAYMENT_COLLECTED = 'PAYMENT_COLLECTED',
  DELIVERED_BY_BUYER = 'DELIVERED_BY_BUYER',
  RETURN_REQUESTED = 'RETURN_REQUESTED',
  RETURN_APPROVED = 'RETURN_APPROVED',
  RETURN_REJECTED = 'RETURN_REJECTED',
  RETURN_SHIPPED_BACK = 'RETURN_SHIPPED_BACK',
  RETURN_RECEIVED = 'RETURN_RECEIVED',
  RETURN_REFUNDED = 'RETURN_REFUNDED',
  RETURN_CLOSED = 'RETURN_CLOSED',
}
```

Other enums in that file (`OrderPaymentMethod`, `OrderPaymentStatus`, `SubOrderFulfillmentStatus`) must stay untouched.

- [ ] **Step 2: Write the migration**

Create `src/database/migrations/1777600000000-CreateReturns.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReturns1777600000000 implements MigrationInterface {
  name = 'CreateReturns1777600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Extend the existing order_event_type_enum with 7 new values.
    //    `ADD VALUE IF NOT EXISTS` is idempotent.
    for (const value of [
      'RETURN_REQUESTED',
      'RETURN_APPROVED',
      'RETURN_REJECTED',
      'RETURN_SHIPPED_BACK',
      'RETURN_RECEIVED',
      'RETURN_REFUNDED',
      'RETURN_CLOSED',
    ]) {
      await queryRunner.query(
        `ALTER TYPE "order_event_type_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }

    // 2. New enum types for returns
    await queryRunner.query(
      `CREATE TYPE "return_status_enum" AS ENUM (` +
        `'REQUESTED','APPROVED','SHIPPED_BACK','RECEIVED',` +
        `'REFUNDED','CLOSED','REJECTED'` +
        `)`,
    );
    await queryRunner.query(
      `CREATE TYPE "return_reason_enum" AS ENUM (` +
        `'NOT_AS_DESCRIBED','DAMAGED','WRONG_ITEM',` +
        `'ARRIVED_LATE','NO_LONGER_NEEDED','OTHER'` +
        `)`,
    );

    // 3. return_request table
    await queryRunner.query(
      `CREATE TABLE "return_request" (` +
        `"id" uuid NOT NULL, ` +
        `"sub_order_id" uuid NOT NULL, ` +
        `"buyer_id" integer NOT NULL, ` +
        `"vendor_id" uuid NOT NULL, ` +
        `"status" "return_status_enum" NOT NULL DEFAULT 'REQUESTED', ` +
        `"reason" "return_reason_enum" NOT NULL, ` +
        `"reason_note" text, ` +
        `"return_tracking_number" varchar(255), ` +
        `"total_refund_minor" bigint NOT NULL, ` +
        `"restocked" boolean, ` +
        `"reject_reason" text, ` +
        `"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `"decided_at" TIMESTAMP WITH TIME ZONE, ` +
        `"shipped_back_at" TIMESTAMP WITH TIME ZONE, ` +
        `"received_at" TIMESTAMP WITH TIME ZONE, ` +
        `"refunded_at" TIMESTAMP WITH TIME ZONE, ` +
        `"closed_at" TIMESTAMP WITH TIME ZONE, ` +
        `"rejected_at" TIMESTAMP WITH TIME ZONE, ` +
        `"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_return_request_id" PRIMARY KEY ("id")` +
        `)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_return_request_buyer_created_at" ` +
        `ON "return_request" ("buyer_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_return_request_vendor_status" ` +
        `ON "return_request" ("vendor_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_return_request_sub_order" ` +
        `ON "return_request" ("sub_order_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "return_request" ADD CONSTRAINT "FK_return_request_sub_order_id" ` +
        `FOREIGN KEY ("sub_order_id") REFERENCES "sub_order"("id") ` +
        `ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "return_request" ADD CONSTRAINT "FK_return_request_buyer_id" ` +
        `FOREIGN KEY ("buyer_id") REFERENCES "user"("id") ` +
        `ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "return_request" ADD CONSTRAINT "FK_return_request_vendor_id" ` +
        `FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ` +
        `ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    // 4. return_item table
    await queryRunner.query(
      `CREATE TABLE "return_item" (` +
        `"id" uuid NOT NULL, ` +
        `"return_request_id" uuid NOT NULL, ` +
        `"order_item_id" uuid NOT NULL, ` +
        `"quantity" integer NOT NULL CHECK ("quantity" >= 1), ` +
        `"refund_amount_minor" bigint NOT NULL, ` +
        `"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_return_item_id" PRIMARY KEY ("id")` +
        `)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_return_item_request" ` +
        `ON "return_item" ("return_request_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_return_item_order_item" ` +
        `ON "return_item" ("order_item_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "return_item" ADD CONSTRAINT "FK_return_item_request_id" ` +
        `FOREIGN KEY ("return_request_id") REFERENCES "return_request"("id") ` +
        `ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "return_item" ADD CONSTRAINT "FK_return_item_order_item_id" ` +
        `FOREIGN KEY ("order_item_id") REFERENCES "order_item"("id") ` +
        `ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    // 5. return_attachment table
    await queryRunner.query(
      `CREATE TABLE "return_attachment" (` +
        `"id" uuid NOT NULL, ` +
        `"return_request_id" uuid NOT NULL, ` +
        `"file_id" uuid NOT NULL, ` +
        `"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_return_attachment_id" PRIMARY KEY ("id")` +
        `)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_return_attachment_request" ` +
        `ON "return_attachment" ("return_request_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "return_attachment" ADD CONSTRAINT "FK_return_attachment_request_id" ` +
        `FOREIGN KEY ("return_request_id") REFERENCES "return_request"("id") ` +
        `ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "return_attachment" ADD CONSTRAINT "FK_return_attachment_file_id" ` +
        `FOREIGN KEY ("file_id") REFERENCES "file"("id") ` +
        `ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "return_attachment" DROP CONSTRAINT "FK_return_attachment_file_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "return_attachment" DROP CONSTRAINT "FK_return_attachment_request_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_return_attachment_request"`);
    await queryRunner.query(`DROP TABLE "return_attachment"`);
    await queryRunner.query(
      `ALTER TABLE "return_item" DROP CONSTRAINT "FK_return_item_order_item_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "return_item" DROP CONSTRAINT "FK_return_item_request_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_return_item_order_item"`);
    await queryRunner.query(`DROP INDEX "public"."idx_return_item_request"`);
    await queryRunner.query(`DROP TABLE "return_item"`);
    await queryRunner.query(
      `ALTER TABLE "return_request" DROP CONSTRAINT "FK_return_request_vendor_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "return_request" DROP CONSTRAINT "FK_return_request_buyer_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "return_request" DROP CONSTRAINT "FK_return_request_sub_order_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_return_request_sub_order"`);
    await queryRunner.query(`DROP INDEX "public"."idx_return_request_vendor_status"`);
    await queryRunner.query(`DROP INDEX "public"."idx_return_request_buyer_created_at"`);
    await queryRunner.query(`DROP TABLE "return_request"`);
    await queryRunner.query(`DROP TYPE "return_reason_enum"`);
    await queryRunner.query(`DROP TYPE "return_status_enum"`);
    // Note: ALTER TYPE ... ADD VALUE is not reversible. The 7 RETURN_*
    // enum values stay in order_event_type_enum on rollback. Safe — no
    // events with those values exist if the migration is rolled back cleanly.
  }
}
```

- [ ] **Step 3: Run the migration locally**

Run: `npm run migration:run`
Expected: `Migration CreateReturns1777600000000 has been executed successfully.`

- [ ] **Step 4: Verify the schema**

Run:
```bash
PGPASSWORD=$(grep '^DATABASE_PASSWORD=' .env | cut -d= -f2) \
  psql -h localhost -p 5432 -U root -d api \
  -c "\d return_request" -c "\d return_item" -c "\d return_attachment" \
  -c "SELECT unnest(enum_range(NULL::return_status_enum))" \
  -c "SELECT unnest(enum_range(NULL::return_reason_enum))"
```

Expected: all three tables print with the FK constraints; both enums list their values.

- [ ] **Step 5: Commit**

```bash
git add src/database/migrations/1777600000000-CreateReturns.ts \
        src/orders/domain/order-enums.ts
git commit -m "feat(returns): migration for return_request, return_item, return_attachment + extend order_event_type_enum"
```

---

## Task 2: Domain types & enums

**Files:**
- Create: `src/returns/domain/return-enums.ts`
- Create: `src/returns/domain/return.ts`
- Create: `src/returns/domain/return-item.ts`
- Create: `src/returns/domain/return-attachment.ts`

- [ ] **Step 1: Enums**

Create `src/returns/domain/return-enums.ts`:

```ts
export enum ReturnStatus {
  REQUESTED = 'REQUESTED',
  APPROVED = 'APPROVED',
  SHIPPED_BACK = 'SHIPPED_BACK',
  RECEIVED = 'RECEIVED',
  REFUNDED = 'REFUNDED',
  CLOSED = 'CLOSED',
  REJECTED = 'REJECTED',
}

export enum ReturnReason {
  NOT_AS_DESCRIBED = 'NOT_AS_DESCRIBED',
  DAMAGED = 'DAMAGED',
  WRONG_ITEM = 'WRONG_ITEM',
  ARRIVED_LATE = 'ARRIVED_LATE',
  NO_LONGER_NEEDED = 'NO_LONGER_NEEDED',
  OTHER = 'OTHER',
}
```

- [ ] **Step 2: Return domain class**

Create `src/returns/domain/return.ts`:

```ts
import { ReturnReason, ReturnStatus } from './return-enums';
import { ReturnItem } from './return-item';
import { ReturnAttachment } from './return-attachment';

export class Return {
  id!: string;
  subOrderId!: string;
  buyerId!: number;
  vendorId!: string;
  status!: ReturnStatus;
  reason!: ReturnReason;
  reasonNote!: string | null;
  returnTrackingNumber!: string | null;
  totalRefundMinor!: string;
  restocked!: boolean | null;
  rejectReason!: string | null;
  createdAt!: Date;
  decidedAt!: Date | null;
  shippedBackAt!: Date | null;
  receivedAt!: Date | null;
  refundedAt!: Date | null;
  closedAt!: Date | null;
  rejectedAt!: Date | null;
  updatedAt!: Date;
  items!: ReturnItem[];
  attachments!: ReturnAttachment[];
}
```

- [ ] **Step 3: ReturnItem domain class**

Create `src/returns/domain/return-item.ts`:

```ts
export class ReturnItem {
  id!: string;
  returnRequestId!: string;
  orderItemId!: string;
  quantity!: number;
  refundAmountMinor!: string;
  createdAt!: Date;
}
```

- [ ] **Step 4: ReturnAttachment domain class**

Create `src/returns/domain/return-attachment.ts`:

```ts
export class ReturnAttachment {
  id!: string;
  returnRequestId!: string;
  fileId!: string;
  createdAt!: Date;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/returns/domain/
git commit -m "feat(returns): domain types and enums"
```

---

## Task 3: State machine + spec (TDD)

**Files:**
- Create: `src/returns/return-state-machine.ts`
- Test: `src/returns/return-state-machine.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/returns/return-state-machine.spec.ts`:

```ts
import { ReturnStatus } from './domain/return-enums';
import {
  assertBuyerTransition,
  assertVendorTransition,
  canBuyerTransition,
  canVendorTransition,
} from './return-state-machine';
import { UnprocessableEntityException } from '@nestjs/common';

describe('return-state-machine', () => {
  describe('canVendorTransition', () => {
    it('should allow REQUESTED -> APPROVED', () => {
      expect(
        canVendorTransition(ReturnStatus.REQUESTED, ReturnStatus.APPROVED),
      ).toBe(true);
    });

    it('should allow REQUESTED -> REJECTED', () => {
      expect(
        canVendorTransition(ReturnStatus.REQUESTED, ReturnStatus.REJECTED),
      ).toBe(true);
    });

    it('should allow SHIPPED_BACK -> RECEIVED', () => {
      expect(
        canVendorTransition(ReturnStatus.SHIPPED_BACK, ReturnStatus.RECEIVED),
      ).toBe(true);
    });

    it('should allow RECEIVED -> REFUNDED', () => {
      expect(
        canVendorTransition(ReturnStatus.RECEIVED, ReturnStatus.REFUNDED),
      ).toBe(true);
    });

    it('should allow RECEIVED -> REJECTED', () => {
      expect(
        canVendorTransition(ReturnStatus.RECEIVED, ReturnStatus.REJECTED),
      ).toBe(true);
    });

    it('should allow REFUNDED -> CLOSED', () => {
      expect(
        canVendorTransition(ReturnStatus.REFUNDED, ReturnStatus.CLOSED),
      ).toBe(true);
    });

    it('should reject vendor SHIPPED_BACK transition (buyer-only)', () => {
      expect(
        canVendorTransition(ReturnStatus.APPROVED, ReturnStatus.SHIPPED_BACK),
      ).toBe(false);
    });

    it('should reject forward skip REQUESTED -> RECEIVED', () => {
      expect(
        canVendorTransition(ReturnStatus.REQUESTED, ReturnStatus.RECEIVED),
      ).toBe(false);
    });

    it('should reject backward APPROVED -> REQUESTED', () => {
      expect(
        canVendorTransition(ReturnStatus.APPROVED, ReturnStatus.REQUESTED),
      ).toBe(false);
    });

    it('should reject any transition out of CLOSED', () => {
      expect(
        canVendorTransition(ReturnStatus.CLOSED, ReturnStatus.REFUNDED),
      ).toBe(false);
    });

    it('should reject any transition out of REJECTED', () => {
      expect(
        canVendorTransition(ReturnStatus.REJECTED, ReturnStatus.APPROVED),
      ).toBe(false);
    });
  });

  describe('canBuyerTransition', () => {
    it('should allow APPROVED -> SHIPPED_BACK', () => {
      expect(
        canBuyerTransition(ReturnStatus.APPROVED, ReturnStatus.SHIPPED_BACK),
      ).toBe(true);
    });

    it('should reject any other buyer transition', () => {
      expect(
        canBuyerTransition(ReturnStatus.REQUESTED, ReturnStatus.APPROVED),
      ).toBe(false);
      expect(
        canBuyerTransition(ReturnStatus.SHIPPED_BACK, ReturnStatus.RECEIVED),
      ).toBe(false);
    });
  });

  describe('assertVendorTransition', () => {
    it('should throw for invalid transition', () => {
      expect(() =>
        assertVendorTransition(ReturnStatus.REQUESTED, ReturnStatus.RECEIVED),
      ).toThrow(UnprocessableEntityException);
    });

    it('should not throw for valid transition', () => {
      expect(() =>
        assertVendorTransition(ReturnStatus.REQUESTED, ReturnStatus.APPROVED),
      ).not.toThrow();
    });
  });

  describe('assertBuyerTransition', () => {
    it('should throw for invalid transition', () => {
      expect(() =>
        assertBuyerTransition(ReturnStatus.REQUESTED, ReturnStatus.APPROVED),
      ).toThrow(UnprocessableEntityException);
    });

    it('should not throw for valid transition', () => {
      expect(() =>
        assertBuyerTransition(ReturnStatus.APPROVED, ReturnStatus.SHIPPED_BACK),
      ).not.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npm test -- src/returns/return-state-machine.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the state machine**

Create `src/returns/return-state-machine.ts`:

```ts
import { UnprocessableEntityException } from '@nestjs/common';
import { ReturnStatus } from './domain/return-enums';

const VENDOR_FORWARD: Record<ReturnStatus, ReadonlySet<ReturnStatus>> = {
  [ReturnStatus.REQUESTED]: new Set([
    ReturnStatus.APPROVED,
    ReturnStatus.REJECTED,
  ]),
  [ReturnStatus.APPROVED]: new Set<ReturnStatus>(),
  [ReturnStatus.SHIPPED_BACK]: new Set([ReturnStatus.RECEIVED]),
  [ReturnStatus.RECEIVED]: new Set([
    ReturnStatus.REFUNDED,
    ReturnStatus.REJECTED,
  ]),
  [ReturnStatus.REFUNDED]: new Set([ReturnStatus.CLOSED]),
  [ReturnStatus.CLOSED]: new Set<ReturnStatus>(),
  [ReturnStatus.REJECTED]: new Set<ReturnStatus>(),
};

const BUYER_FORWARD: Record<ReturnStatus, ReadonlySet<ReturnStatus>> = {
  [ReturnStatus.REQUESTED]: new Set<ReturnStatus>(),
  [ReturnStatus.APPROVED]: new Set([ReturnStatus.SHIPPED_BACK]),
  [ReturnStatus.SHIPPED_BACK]: new Set<ReturnStatus>(),
  [ReturnStatus.RECEIVED]: new Set<ReturnStatus>(),
  [ReturnStatus.REFUNDED]: new Set<ReturnStatus>(),
  [ReturnStatus.CLOSED]: new Set<ReturnStatus>(),
  [ReturnStatus.REJECTED]: new Set<ReturnStatus>(),
};

export function canVendorTransition(
  from: ReturnStatus,
  to: ReturnStatus,
): boolean {
  return VENDOR_FORWARD[from]?.has(to) ?? false;
}

export function canBuyerTransition(
  from: ReturnStatus,
  to: ReturnStatus,
): boolean {
  return BUYER_FORWARD[from]?.has(to) ?? false;
}

export function assertVendorTransition(
  from: ReturnStatus,
  to: ReturnStatus,
): void {
  if (!canVendorTransition(from, to)) {
    throw new UnprocessableEntityException(
      `Invalid return transition: ${from} → ${to}`,
    );
  }
}

export function assertBuyerTransition(
  from: ReturnStatus,
  to: ReturnStatus,
): void {
  if (!canBuyerTransition(from, to)) {
    throw new UnprocessableEntityException(
      `Invalid return transition: ${from} → ${to}`,
    );
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- src/returns/return-state-machine.spec.ts`
Expected: all 17 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/returns/return-state-machine.ts src/returns/return-state-machine.spec.ts
git commit -m "feat(returns): state machine for buyer + vendor transitions"
```

---

## Task 4: Abstract repository

**Files:**
- Create: `src/returns/infrastructure/persistence/return.abstract.repository.ts`

- [ ] **Step 1: Write the contract**

Create `src/returns/infrastructure/persistence/return.abstract.repository.ts`:

```ts
import { Return } from '../../domain/return';
import { ReturnReason, ReturnStatus } from '../../domain/return-enums';

export interface CreateReturnInput {
  id: string;
  subOrderId: string;
  buyerId: number;
  vendorId: string;
  reason: ReturnReason;
  reasonNote: string | null;
  totalRefundMinor: string;
  items: Array<{
    id: string;
    orderItemId: string;
    quantity: number;
    refundAmountMinor: string;
  }>;
  attachmentFileIds: string[];
}

export interface ListForBuyerOptions {
  buyerId: number;
  subOrderId?: string;
  status?: ReturnStatus;
  page: number;
  limit: number;
}

export interface ListForVendorOptions {
  vendorId: string;
  subOrderId?: string;
  status?: ReturnStatus;
  page: number;
  limit: number;
}

export interface AdminListOptions {
  vendorId?: string;
  buyerId?: number;
  status?: ReturnStatus;
  page: number;
  limit: number;
}

export interface ListResult {
  data: Return[];
  total: number;
}

export interface CountOpenForOrderItemsInput {
  orderItemIds: string[];
}

export interface MarkApprovedInput {
  id: string;
  decidedAt: Date;
}

export interface MarkRejectedInput {
  id: string;
  rejectReason: string;
  rejectedAt: Date;
  fromStatus: ReturnStatus;
}

export interface MarkShippedBackInput {
  id: string;
  trackingNumber: string | null;
  shippedBackAt: Date;
}

export interface MarkReceivedInput {
  id: string;
  restock: boolean;
  receivedAt: Date;
  /**
   * Pairs of (variantId, qtyDelta) to apply to variant_stock when restock=true.
   * Empty when restock=false.
   */
  stockIncrements: Array<{ variantId: string; delta: number }>;
}

export interface MarkRefundedInput {
  id: string;
  refundedAt: Date;
}

export interface MarkClosedInput {
  id: string;
  closedAt: Date;
}

export abstract class ReturnAbstractRepository {
  abstract create(input: CreateReturnInput): Promise<Return>;
  abstract findById(id: string): Promise<Return | null>;
  abstract listForBuyer(opts: ListForBuyerOptions): Promise<ListResult>;
  abstract listForVendor(opts: ListForVendorOptions): Promise<ListResult>;
  abstract listForAdmin(opts: AdminListOptions): Promise<ListResult>;

  /**
   * Returns sum of `return_item.quantity` per `order_item_id`,
   * counting only return_requests whose status is NOT in (REJECTED).
   * Used to enforce the open-RMA + cumulative-quantity constraint at create-time.
   */
  abstract sumNonRejectedQuantitiesByOrderItem(
    input: CountOpenForOrderItemsInput,
  ): Promise<Map<string, number>>;

  abstract markApproved(input: MarkApprovedInput): Promise<Return>;
  abstract markRejected(input: MarkRejectedInput): Promise<Return>;
  abstract markShippedBack(input: MarkShippedBackInput): Promise<Return>;
  abstract markReceived(input: MarkReceivedInput): Promise<Return>;
  abstract markRefunded(input: MarkRefundedInput): Promise<Return>;
  abstract markClosed(input: MarkClosedInput): Promise<Return>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/returns/infrastructure/persistence/return.abstract.repository.ts
git commit -m "feat(returns): abstract repository contract"
```

---

## Task 5: Relational entities + mappers

**Files:**
- Create: `src/returns/infrastructure/persistence/relational/entities/return-request.entity.ts`
- Create: `src/returns/infrastructure/persistence/relational/entities/return-item.entity.ts`
- Create: `src/returns/infrastructure/persistence/relational/entities/return-attachment.entity.ts`
- Create: `src/returns/infrastructure/persistence/relational/mappers/return.mapper.ts`

- [ ] **Step 1: ReturnRequestEntity**

Create `src/returns/infrastructure/persistence/relational/entities/return-request.entity.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { VendorEntity } from '../../../../../vendors/infrastructure/persistence/relational/entities/vendor.entity';
import { SubOrderEntity } from '../../../../../orders/infrastructure/persistence/relational/entities/sub-order.entity';
import { ReturnReason, ReturnStatus } from '../../../../domain/return-enums';
import { ReturnItemEntity } from './return-item.entity';
import { ReturnAttachmentEntity } from './return-attachment.entity';

@Entity({ name: 'return_request' })
@Index('idx_return_request_buyer_created_at', ['buyerId', 'createdAt'])
@Index('idx_return_request_vendor_status', ['vendorId', 'status'])
@Index('idx_return_request_sub_order', ['subOrderId'])
export class ReturnRequestEntity extends EntityRelationalHelper {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'sub_order_id', type: 'uuid' })
  subOrderId!: string;

  @ManyToOne(() => SubOrderEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sub_order_id' })
  subOrder!: SubOrderEntity;

  @Column({ name: 'buyer_id', type: 'integer' })
  buyerId!: number;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'buyer_id' })
  buyer!: UserEntity;

  @Column({ name: 'vendor_id', type: 'uuid' })
  vendorId!: string;

  @ManyToOne(() => VendorEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'vendor_id' })
  vendor!: VendorEntity;

  @Column({
    type: 'enum',
    enum: ReturnStatus,
    enumName: 'return_status_enum',
    default: ReturnStatus.REQUESTED,
  })
  status!: ReturnStatus;

  @Column({
    type: 'enum',
    enum: ReturnReason,
    enumName: 'return_reason_enum',
  })
  reason!: ReturnReason;

  @Column({ name: 'reason_note', type: 'text', nullable: true })
  reasonNote!: string | null;

  @Column({
    name: 'return_tracking_number',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  returnTrackingNumber!: string | null;

  @Column({ name: 'total_refund_minor', type: 'bigint' })
  totalRefundMinor!: string;

  @Column({ type: 'boolean', nullable: true })
  restocked!: boolean | null;

  @Column({ name: 'reject_reason', type: 'text', nullable: true })
  rejectReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  @Column({ name: 'shipped_back_at', type: 'timestamptz', nullable: true })
  shippedBackAt!: Date | null;

  @Column({ name: 'received_at', type: 'timestamptz', nullable: true })
  receivedAt!: Date | null;

  @Column({ name: 'refunded_at', type: 'timestamptz', nullable: true })
  refundedAt!: Date | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ name: 'rejected_at', type: 'timestamptz', nullable: true })
  rejectedAt!: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => ReturnItemEntity, (i) => i.returnRequest, { cascade: true })
  items!: ReturnItemEntity[];

  @OneToMany(() => ReturnAttachmentEntity, (a) => a.returnRequest, {
    cascade: true,
  })
  attachments!: ReturnAttachmentEntity[];
}
```

- [ ] **Step 2: ReturnItemEntity**

Create `src/returns/infrastructure/persistence/relational/entities/return-item.entity.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { OrderItemEntity } from '../../../../../orders/infrastructure/persistence/relational/entities/order-item.entity';
import { ReturnRequestEntity } from './return-request.entity';

@Entity({ name: 'return_item' })
@Index('idx_return_item_request', ['returnRequestId'])
@Index('idx_return_item_order_item', ['orderItemId'])
export class ReturnItemEntity extends EntityRelationalHelper {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'return_request_id', type: 'uuid' })
  returnRequestId!: string;

  @ManyToOne(() => ReturnRequestEntity, (r) => r.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'return_request_id' })
  returnRequest!: ReturnRequestEntity;

  @Column({ name: 'order_item_id', type: 'uuid' })
  orderItemId!: string;

  @ManyToOne(() => OrderItemEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'order_item_id' })
  orderItem!: OrderItemEntity;

  @Column({ type: 'integer' })
  quantity!: number;

  @Column({ name: 'refund_amount_minor', type: 'bigint' })
  refundAmountMinor!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
```

- [ ] **Step 3: ReturnAttachmentEntity**

Create `src/returns/infrastructure/persistence/relational/entities/return-attachment.entity.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { FileEntity } from '../../../../../files/infrastructure/persistence/relational/entities/file.entity';
import { ReturnRequestEntity } from './return-request.entity';

@Entity({ name: 'return_attachment' })
@Index('idx_return_attachment_request', ['returnRequestId'])
export class ReturnAttachmentEntity extends EntityRelationalHelper {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'return_request_id', type: 'uuid' })
  returnRequestId!: string;

  @ManyToOne(() => ReturnRequestEntity, (r) => r.attachments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'return_request_id' })
  returnRequest!: ReturnRequestEntity;

  @Column({ name: 'file_id', type: 'uuid' })
  fileId!: string;

  @ManyToOne(() => FileEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'file_id' })
  file!: FileEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
```

- [ ] **Step 4: Mapper**

Create `src/returns/infrastructure/persistence/relational/mappers/return.mapper.ts`:

```ts
import { Return } from '../../../../domain/return';
import { ReturnAttachment } from '../../../../domain/return-attachment';
import { ReturnItem } from '../../../../domain/return-item';
import { ReturnAttachmentEntity } from '../entities/return-attachment.entity';
import { ReturnItemEntity } from '../entities/return-item.entity';
import { ReturnRequestEntity } from '../entities/return-request.entity';

export class ReturnMapper {
  static toDomain(entity: ReturnRequestEntity): Return {
    const dom = new Return();
    dom.id = entity.id;
    dom.subOrderId = entity.subOrderId;
    dom.buyerId = entity.buyerId;
    dom.vendorId = entity.vendorId;
    dom.status = entity.status;
    dom.reason = entity.reason;
    dom.reasonNote = entity.reasonNote ?? null;
    dom.returnTrackingNumber = entity.returnTrackingNumber ?? null;
    dom.totalRefundMinor = entity.totalRefundMinor;
    dom.restocked = entity.restocked ?? null;
    dom.rejectReason = entity.rejectReason ?? null;
    dom.createdAt = entity.createdAt;
    dom.decidedAt = entity.decidedAt ?? null;
    dom.shippedBackAt = entity.shippedBackAt ?? null;
    dom.receivedAt = entity.receivedAt ?? null;
    dom.refundedAt = entity.refundedAt ?? null;
    dom.closedAt = entity.closedAt ?? null;
    dom.rejectedAt = entity.rejectedAt ?? null;
    dom.updatedAt = entity.updatedAt;
    dom.items = (entity.items ?? []).map(ReturnMapper.itemToDomain);
    dom.attachments = (entity.attachments ?? []).map(
      ReturnMapper.attachmentToDomain,
    );
    return dom;
  }

  static itemToDomain(entity: ReturnItemEntity): ReturnItem {
    const dom = new ReturnItem();
    dom.id = entity.id;
    dom.returnRequestId = entity.returnRequestId;
    dom.orderItemId = entity.orderItemId;
    dom.quantity = entity.quantity;
    dom.refundAmountMinor = entity.refundAmountMinor;
    dom.createdAt = entity.createdAt;
    return dom;
  }

  static attachmentToDomain(entity: ReturnAttachmentEntity): ReturnAttachment {
    const dom = new ReturnAttachment();
    dom.id = entity.id;
    dom.returnRequestId = entity.returnRequestId;
    dom.fileId = entity.fileId;
    dom.createdAt = entity.createdAt;
    return dom;
  }
}
```

- [ ] **Step 5: Verify FileEntity import path**

Run: `ls src/files/infrastructure/persistence/relational/entities/`

Expected: a file containing `FileEntity`. If the path differs from `file.entity.ts`, adjust the import in `return-attachment.entity.ts` accordingly.

- [ ] **Step 6: Commit**

```bash
git add src/returns/infrastructure/persistence/relational/entities/ \
        src/returns/infrastructure/persistence/relational/mappers/
git commit -m "feat(returns): relational entities and mapper"
```

---

## Task 6: Relational repository + persistence module

**Files:**
- Create: `src/returns/infrastructure/persistence/relational/repositories/return.repository.ts`
- Create: `src/returns/infrastructure/persistence/relational/relational-persistence.module.ts`

- [ ] **Step 1: Repository**

Create `src/returns/infrastructure/persistence/relational/repositories/return.repository.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { OrderEventEntity } from '../../../../../orders/infrastructure/persistence/relational/entities/order-event.entity';
import { OrderEventType } from '../../../../../orders/domain/order-enums';
import { uuidv7Generate } from '../../../../../utils/uuid';
import { Return } from '../../../../domain/return';
import { ReturnStatus } from '../../../../domain/return-enums';
import {
  AdminListOptions,
  CountOpenForOrderItemsInput,
  CreateReturnInput,
  ListForBuyerOptions,
  ListForVendorOptions,
  ListResult,
  MarkApprovedInput,
  MarkClosedInput,
  MarkReceivedInput,
  MarkRefundedInput,
  MarkRejectedInput,
  MarkShippedBackInput,
  ReturnAbstractRepository,
} from '../../return.abstract.repository';
import { ReturnAttachmentEntity } from '../entities/return-attachment.entity';
import { ReturnItemEntity } from '../entities/return-item.entity';
import { ReturnRequestEntity } from '../entities/return-request.entity';
import { ReturnMapper } from '../mappers/return.mapper';

@Injectable()
export class ReturnRelationalRepository implements ReturnAbstractRepository {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(ReturnRequestEntity)
    private readonly repo: Repository<ReturnRequestEntity>,
  ) {}

  async create(input: CreateReturnInput): Promise<Return> {
    return this.dataSource.transaction(async (em) => {
      const requestRepo = em.getRepository(ReturnRequestEntity);
      const itemRepo = em.getRepository(ReturnItemEntity);
      const attachmentRepo = em.getRepository(ReturnAttachmentEntity);
      const eventRepo = em.getRepository(OrderEventEntity);

      const requestRow = requestRepo.create({
        id: input.id,
        subOrderId: input.subOrderId,
        buyerId: input.buyerId,
        vendorId: input.vendorId,
        status: ReturnStatus.REQUESTED,
        reason: input.reason,
        reasonNote: input.reasonNote,
        totalRefundMinor: input.totalRefundMinor,
        restocked: null,
        rejectReason: null,
        decidedAt: null,
        shippedBackAt: null,
        receivedAt: null,
        refundedAt: null,
        closedAt: null,
        rejectedAt: null,
        returnTrackingNumber: null,
      });
      await requestRepo.save(requestRow);

      const itemRows = input.items.map((i) =>
        itemRepo.create({
          id: i.id,
          returnRequestId: input.id,
          orderItemId: i.orderItemId,
          quantity: i.quantity,
          refundAmountMinor: i.refundAmountMinor,
        }),
      );
      if (itemRows.length > 0) {
        await itemRepo.save(itemRows);
      }

      const attachmentRows = input.attachmentFileIds.map((fileId) =>
        attachmentRepo.create({
          id: uuidv7Generate(),
          returnRequestId: input.id,
          fileId,
        }),
      );
      if (attachmentRows.length > 0) {
        await attachmentRepo.save(attachmentRows);
      }

      await eventRepo.insert({
        id: uuidv7Generate(),
        subOrderId: input.subOrderId,
        eventType: OrderEventType.RETURN_REQUESTED,
        fromStatus: null,
        toStatus: ReturnStatus.REQUESTED,
        actorUserId: input.buyerId,
        payload: { returnRequestId: input.id, reason: input.reason },
      });

      return this.loadAndMap(em, input.id);
    });
  }

  async findById(id: string): Promise<Return | null> {
    const row = await this.repo.findOne({
      where: { id },
      relations: { items: true, attachments: true },
    });
    return row ? ReturnMapper.toDomain(row) : null;
  }

  async listForBuyer(opts: ListForBuyerOptions): Promise<ListResult> {
    const offset = (opts.page - 1) * opts.limit;
    const qb = this.repo
      .createQueryBuilder('rr')
      .leftJoinAndSelect('rr.items', 'items')
      .leftJoinAndSelect('rr.attachments', 'attachments')
      .where('rr.buyer_id = :buyerId', { buyerId: opts.buyerId });
    if (opts.subOrderId) {
      qb.andWhere('rr.sub_order_id = :subOrderId', {
        subOrderId: opts.subOrderId,
      });
    }
    if (opts.status) {
      qb.andWhere('rr.status = :status', { status: opts.status });
    }
    const [rows, total] = await qb
      .orderBy('rr.created_at', 'DESC')
      .skip(offset)
      .take(opts.limit)
      .getManyAndCount();
    return { data: rows.map(ReturnMapper.toDomain), total };
  }

  async listForVendor(opts: ListForVendorOptions): Promise<ListResult> {
    const offset = (opts.page - 1) * opts.limit;
    const qb = this.repo
      .createQueryBuilder('rr')
      .leftJoinAndSelect('rr.items', 'items')
      .leftJoinAndSelect('rr.attachments', 'attachments')
      .where('rr.vendor_id = :vendorId', { vendorId: opts.vendorId });
    if (opts.subOrderId) {
      qb.andWhere('rr.sub_order_id = :subOrderId', {
        subOrderId: opts.subOrderId,
      });
    }
    if (opts.status) {
      qb.andWhere('rr.status = :status', { status: opts.status });
    }
    const [rows, total] = await qb
      .orderBy('rr.created_at', 'DESC')
      .skip(offset)
      .take(opts.limit)
      .getManyAndCount();
    return { data: rows.map(ReturnMapper.toDomain), total };
  }

  async listForAdmin(opts: AdminListOptions): Promise<ListResult> {
    const offset = (opts.page - 1) * opts.limit;
    const qb = this.repo
      .createQueryBuilder('rr')
      .leftJoinAndSelect('rr.items', 'items')
      .leftJoinAndSelect('rr.attachments', 'attachments');
    if (opts.vendorId) {
      qb.andWhere('rr.vendor_id = :vendorId', { vendorId: opts.vendorId });
    }
    if (opts.buyerId !== undefined) {
      qb.andWhere('rr.buyer_id = :buyerId', { buyerId: opts.buyerId });
    }
    if (opts.status) {
      qb.andWhere('rr.status = :status', { status: opts.status });
    }
    const [rows, total] = await qb
      .orderBy('rr.created_at', 'DESC')
      .skip(offset)
      .take(opts.limit)
      .getManyAndCount();
    return { data: rows.map(ReturnMapper.toDomain), total };
  }

  async sumNonRejectedQuantitiesByOrderItem(
    input: CountOpenForOrderItemsInput,
  ): Promise<Map<string, number>> {
    if (input.orderItemIds.length === 0) return new Map();
    const rows = await this.dataSource
      .getRepository(ReturnItemEntity)
      .createQueryBuilder('ri')
      .innerJoin('ri.returnRequest', 'rr')
      .select('ri.order_item_id', 'orderItemId')
      .addSelect('COALESCE(SUM(ri.quantity), 0)', 'qty')
      .where('ri.order_item_id IN (:...ids)', { ids: input.orderItemIds })
      .andWhere('rr.status != :rejected', { rejected: ReturnStatus.REJECTED })
      .groupBy('ri.order_item_id')
      .getRawMany<{ orderItemId: string; qty: string }>();
    return new Map(rows.map((r) => [r.orderItemId, Number(r.qty)]));
  }

  async markApproved(input: MarkApprovedInput): Promise<Return> {
    return this.dataSource.transaction(async (em) => {
      const requestRepo = em.getRepository(ReturnRequestEntity);
      const eventRepo = em.getRepository(OrderEventEntity);
      const row = await requestRepo.findOne({ where: { id: input.id } });
      if (!row) throw new NotFoundException(`Return ${input.id} not found`);
      row.status = ReturnStatus.APPROVED;
      row.decidedAt = input.decidedAt;
      await requestRepo.save(row);
      await eventRepo.insert({
        id: uuidv7Generate(),
        subOrderId: row.subOrderId,
        eventType: OrderEventType.RETURN_APPROVED,
        fromStatus: ReturnStatus.REQUESTED,
        toStatus: ReturnStatus.APPROVED,
        actorUserId: null,
        payload: { returnRequestId: input.id },
      });
      return this.loadAndMap(em, input.id);
    });
  }

  async markRejected(input: MarkRejectedInput): Promise<Return> {
    return this.dataSource.transaction(async (em) => {
      const requestRepo = em.getRepository(ReturnRequestEntity);
      const eventRepo = em.getRepository(OrderEventEntity);
      const row = await requestRepo.findOne({ where: { id: input.id } });
      if (!row) throw new NotFoundException(`Return ${input.id} not found`);
      row.status = ReturnStatus.REJECTED;
      row.rejectReason = input.rejectReason;
      row.rejectedAt = input.rejectedAt;
      // decidedAt records the FIRST decision; only set if not already set.
      if (!row.decidedAt) row.decidedAt = input.rejectedAt;
      await requestRepo.save(row);
      await eventRepo.insert({
        id: uuidv7Generate(),
        subOrderId: row.subOrderId,
        eventType: OrderEventType.RETURN_REJECTED,
        fromStatus: input.fromStatus,
        toStatus: ReturnStatus.REJECTED,
        actorUserId: null,
        payload: {
          returnRequestId: input.id,
          rejectReason: input.rejectReason,
        },
      });
      return this.loadAndMap(em, input.id);
    });
  }

  async markShippedBack(input: MarkShippedBackInput): Promise<Return> {
    return this.dataSource.transaction(async (em) => {
      const requestRepo = em.getRepository(ReturnRequestEntity);
      const eventRepo = em.getRepository(OrderEventEntity);
      const row = await requestRepo.findOne({ where: { id: input.id } });
      if (!row) throw new NotFoundException(`Return ${input.id} not found`);
      row.status = ReturnStatus.SHIPPED_BACK;
      row.shippedBackAt = input.shippedBackAt;
      row.returnTrackingNumber = input.trackingNumber;
      await requestRepo.save(row);
      await eventRepo.insert({
        id: uuidv7Generate(),
        subOrderId: row.subOrderId,
        eventType: OrderEventType.RETURN_SHIPPED_BACK,
        fromStatus: ReturnStatus.APPROVED,
        toStatus: ReturnStatus.SHIPPED_BACK,
        actorUserId: row.buyerId,
        payload: {
          returnRequestId: input.id,
          trackingNumber: input.trackingNumber,
        },
      });
      return this.loadAndMap(em, input.id);
    });
  }

  async markReceived(input: MarkReceivedInput): Promise<Return> {
    return this.dataSource.transaction(async (em) => {
      const requestRepo = em.getRepository(ReturnRequestEntity);
      const eventRepo = em.getRepository(OrderEventEntity);
      const row = await requestRepo.findOne({ where: { id: input.id } });
      if (!row) throw new NotFoundException(`Return ${input.id} not found`);
      row.status = ReturnStatus.RECEIVED;
      row.receivedAt = input.receivedAt;
      row.restocked = input.restock;
      await requestRepo.save(row);

      // Cross-domain restock — performed inside the same transaction so the
      // RMA status flip and the stock increment are atomic. Uses raw SQL
      // increment to avoid a separate read-modify-write race.
      if (input.restock) {
        for (const inc of input.stockIncrements) {
          await em.query(
            `UPDATE "variant_stock" SET "quantity" = "quantity" + $1 WHERE "variant_id" = $2`,
            [inc.delta, inc.variantId],
          );
        }
      }

      await eventRepo.insert({
        id: uuidv7Generate(),
        subOrderId: row.subOrderId,
        eventType: OrderEventType.RETURN_RECEIVED,
        fromStatus: ReturnStatus.SHIPPED_BACK,
        toStatus: ReturnStatus.RECEIVED,
        actorUserId: null,
        payload: { returnRequestId: input.id, restock: input.restock },
      });
      return this.loadAndMap(em, input.id);
    });
  }

  async markRefunded(input: MarkRefundedInput): Promise<Return> {
    return this.dataSource.transaction(async (em) => {
      const requestRepo = em.getRepository(ReturnRequestEntity);
      const eventRepo = em.getRepository(OrderEventEntity);
      const row = await requestRepo.findOne({ where: { id: input.id } });
      if (!row) throw new NotFoundException(`Return ${input.id} not found`);
      row.status = ReturnStatus.REFUNDED;
      row.refundedAt = input.refundedAt;
      await requestRepo.save(row);
      await eventRepo.insert({
        id: uuidv7Generate(),
        subOrderId: row.subOrderId,
        eventType: OrderEventType.RETURN_REFUNDED,
        fromStatus: ReturnStatus.RECEIVED,
        toStatus: ReturnStatus.REFUNDED,
        actorUserId: null,
        payload: { returnRequestId: input.id },
      });
      return this.loadAndMap(em, input.id);
    });
  }

  async markClosed(input: MarkClosedInput): Promise<Return> {
    return this.dataSource.transaction(async (em) => {
      const requestRepo = em.getRepository(ReturnRequestEntity);
      const eventRepo = em.getRepository(OrderEventEntity);
      const row = await requestRepo.findOne({ where: { id: input.id } });
      if (!row) throw new NotFoundException(`Return ${input.id} not found`);
      row.status = ReturnStatus.CLOSED;
      row.closedAt = input.closedAt;
      await requestRepo.save(row);
      await eventRepo.insert({
        id: uuidv7Generate(),
        subOrderId: row.subOrderId,
        eventType: OrderEventType.RETURN_CLOSED,
        fromStatus: ReturnStatus.REFUNDED,
        toStatus: ReturnStatus.CLOSED,
        actorUserId: null,
        payload: { returnRequestId: input.id },
      });
      return this.loadAndMap(em, input.id);
    });
  }

  private async loadAndMap(
    em: Parameters<DataSource['transaction']>[0] extends (
      arg: infer M,
    ) => unknown
      ? M
      : never,
    id: string,
  ): Promise<Return> {
    const row = await em.getRepository(ReturnRequestEntity).findOne({
      where: { id },
      relations: { items: true, attachments: true },
    });
    if (!row) throw new NotFoundException(`Return ${id} not found after write`);
    return ReturnMapper.toDomain(row);
  }
}
```

If TypeScript complains about the `loadAndMap` parameter type, replace it with `EntityManager` from `typeorm`:

```ts
private async loadAndMap(em: EntityManager, id: string): Promise<Return> {
```

And add `EntityManager` to the imports.

- [ ] **Step 2: Persistence module**

Create `src/returns/infrastructure/persistence/relational/relational-persistence.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReturnAbstractRepository } from '../return.abstract.repository';
import { ReturnAttachmentEntity } from './entities/return-attachment.entity';
import { ReturnItemEntity } from './entities/return-item.entity';
import { ReturnRequestEntity } from './entities/return-request.entity';
import { ReturnRelationalRepository } from './repositories/return.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReturnRequestEntity,
      ReturnItemEntity,
      ReturnAttachmentEntity,
    ]),
  ],
  providers: [
    {
      provide: ReturnAbstractRepository,
      useClass: ReturnRelationalRepository,
    },
  ],
  exports: [ReturnAbstractRepository],
})
export class RelationalReturnPersistenceModule {}
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/returns/infrastructure/persistence/relational/repositories/ \
        src/returns/infrastructure/persistence/relational/relational-persistence.module.ts
git commit -m "feat(returns): relational repository implementation"
```

---

## Task 7: DTOs

**Files:**
- Create: `src/returns/dto/create-return.dto.ts`
- Create: `src/returns/dto/confirm-shipped-back.dto.ts`
- Create: `src/returns/dto/transition-return.dto.ts`
- Create: `src/returns/dto/return-response.dto.ts`

- [ ] **Step 1: CreateReturnDto**

Create `src/returns/dto/create-return.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { ReturnReason } from '../domain/return-enums';

export class CreateReturnItemDto {
  @ApiProperty()
  @IsUUID('4')
  orderItemId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateReturnDto {
  @ApiProperty({ type: [CreateReturnItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateReturnItemDto)
  items!: CreateReturnItemDto[];

  @ApiProperty({ enum: ReturnReason })
  @IsEnum(ReturnReason)
  reason!: ReturnReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reasonNote?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsUUID('4', { each: true })
  fileIds?: string[];
}
```

- [ ] **Step 2: ConfirmShippedBackDto**

Create `src/returns/dto/confirm-shipped-back.dto.ts`:

```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ConfirmShippedBackDto {
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  trackingNumber?: string;
}
```

- [ ] **Step 3: TransitionReturnDto**

Create `src/returns/dto/transition-return.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ReturnStatus } from '../domain/return-enums';

export type VendorTargetStatus =
  | ReturnStatus.APPROVED
  | ReturnStatus.REJECTED
  | ReturnStatus.RECEIVED
  | ReturnStatus.REFUNDED
  | ReturnStatus.CLOSED;

export class TransitionReturnDto {
  @ApiProperty({
    enum: [
      ReturnStatus.APPROVED,
      ReturnStatus.REJECTED,
      ReturnStatus.RECEIVED,
      ReturnStatus.REFUNDED,
      ReturnStatus.CLOSED,
    ],
  })
  @IsEnum(ReturnStatus)
  status!: VendorTargetStatus;

  @ApiPropertyOptional({ description: 'Required when status = REJECTED' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rejectReason?: string;

  @ApiPropertyOptional({ description: 'Required when status = RECEIVED' })
  @IsOptional()
  @IsBoolean()
  restock?: boolean;
}
```

- [ ] **Step 4: ReturnResponseDto**

Create `src/returns/dto/return-response.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { Return } from '../domain/return';
import { ReturnReason, ReturnStatus } from '../domain/return-enums';

export class ReturnItemResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderItemId!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() refundAmountMinor!: string;
}

export class ReturnAttachmentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() fileId!: string;
}

export class ReturnResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() subOrderId!: string;
  @ApiProperty() vendorId!: string;
  @ApiProperty({ enum: ReturnStatus }) status!: ReturnStatus;
  @ApiProperty({ enum: ReturnReason }) reason!: ReturnReason;
  @ApiProperty({ required: false, nullable: true }) reasonNote!: string | null;
  @ApiProperty({ required: false, nullable: true })
  returnTrackingNumber!: string | null;
  @ApiProperty() totalRefundMinor!: string;
  @ApiProperty({ required: false, nullable: true })
  restocked!: boolean | null;
  @ApiProperty({ required: false, nullable: true })
  rejectReason!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ required: false, nullable: true })
  decidedAt!: Date | null;
  @ApiProperty({ required: false, nullable: true })
  shippedBackAt!: Date | null;
  @ApiProperty({ required: false, nullable: true })
  receivedAt!: Date | null;
  @ApiProperty({ required: false, nullable: true })
  refundedAt!: Date | null;
  @ApiProperty({ required: false, nullable: true })
  closedAt!: Date | null;
  @ApiProperty({ required: false, nullable: true })
  rejectedAt!: Date | null;
  @ApiProperty({ type: [ReturnItemResponseDto] })
  items!: ReturnItemResponseDto[];
  @ApiProperty({ type: [ReturnAttachmentResponseDto] })
  attachments!: ReturnAttachmentResponseDto[];

  static from(r: Return): ReturnResponseDto {
    const dto = new ReturnResponseDto();
    dto.id = r.id;
    dto.subOrderId = r.subOrderId;
    dto.vendorId = r.vendorId;
    dto.status = r.status;
    dto.reason = r.reason;
    dto.reasonNote = r.reasonNote;
    dto.returnTrackingNumber = r.returnTrackingNumber;
    dto.totalRefundMinor = r.totalRefundMinor;
    dto.restocked = r.restocked;
    dto.rejectReason = r.rejectReason;
    dto.createdAt = r.createdAt;
    dto.decidedAt = r.decidedAt;
    dto.shippedBackAt = r.shippedBackAt;
    dto.receivedAt = r.receivedAt;
    dto.refundedAt = r.refundedAt;
    dto.closedAt = r.closedAt;
    dto.rejectedAt = r.rejectedAt;
    dto.items = r.items.map((i) => ({
      id: i.id,
      orderItemId: i.orderItemId,
      quantity: i.quantity,
      refundAmountMinor: i.refundAmountMinor,
    }));
    dto.attachments = r.attachments.map((a) => ({
      id: a.id,
      fileId: a.fileId,
    }));
    return dto;
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/returns/dto/
git commit -m "feat(returns): request and response DTOs"
```

---

## Task 8: ReturnsService — create + state transitions (TDD)

**Files:**
- Create: `src/returns/returns.service.ts`
- Test: `src/returns/returns.service.spec.ts`

This task is large because the service is the heart of the module. The TDD spec drives the design.

- [ ] **Step 1: Write the failing tests**

Create `src/returns/returns.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ReturnsService } from './returns.service';
import { ReturnAbstractRepository } from './infrastructure/persistence/return.abstract.repository';
import { OrderAbstractRepository } from '../orders/infrastructure/persistence/order.abstract.repository';
import { FilesService } from '../files/files.service';
import { VendorsService } from '../vendors/vendors.service';
import { Return } from './domain/return';
import { ReturnReason, ReturnStatus } from './domain/return-enums';
import { Order } from '../orders/domain/order';
import { SubOrderFulfillmentStatus } from '../orders/domain/order-enums';

describe('ReturnsService', () => {
  let service: ReturnsService;
  let returnsRepo: jest.Mocked<ReturnAbstractRepository>;
  let ordersRepo: jest.Mocked<OrderAbstractRepository>;
  let filesService: jest.Mocked<FilesService>;
  let vendorsService: jest.Mocked<VendorsService>;

  const NOW = new Date('2026-05-15T10:00:00Z');
  const DELIVERED_AT = new Date('2026-05-10T12:00:00Z'); // 5 days ago
  const RETURN_WINDOW_DAYS = 7;

  const mockOrder = (overrides?: Partial<Order>): Order => {
    const order = new Order();
    order.id = 'order-1';
    order.buyerId = 100;
    order.subOrders = [
      {
        id: 'so-1',
        vendorId: 'vendor-1',
        fulfillmentStatus: SubOrderFulfillmentStatus.DELIVERED,
        deliveredAt: DELIVERED_AT,
        items: [
          {
            id: 'oi-1',
            variantId: 'var-1',
            quantity: 2,
            unitPriceSnapshot: '5000',
          },
        ],
      } as never,
    ] as never;
    return Object.assign(order, overrides);
  };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(NOW);

    returnsRepo = {
      create: jest.fn(),
      findById: jest.fn(),
      listForBuyer: jest.fn(),
      listForVendor: jest.fn(),
      listForAdmin: jest.fn(),
      sumNonRejectedQuantitiesByOrderItem: jest.fn().mockResolvedValue(new Map()),
      markApproved: jest.fn(),
      markRejected: jest.fn(),
      markShippedBack: jest.fn(),
      markReceived: jest.fn(),
      markRefunded: jest.fn(),
      markClosed: jest.fn(),
    } as unknown as jest.Mocked<ReturnAbstractRepository>;

    ordersRepo = {
      findHydratedById: jest.fn(),
    } as unknown as jest.Mocked<OrderAbstractRepository>;

    filesService = {
      findByIds: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<FilesService>;

    vendorsService = {
      getById: jest.fn().mockResolvedValue({
        id: 'vendor-1',
        returnWindowDays: RETURN_WINDOW_DAYS,
      }),
    } as unknown as jest.Mocked<VendorsService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReturnsService,
        { provide: ReturnAbstractRepository, useValue: returnsRepo },
        { provide: OrderAbstractRepository, useValue: ordersRepo },
        { provide: FilesService, useValue: filesService },
        { provide: VendorsService, useValue: vendorsService },
      ],
    }).compile();
    service = moduleRef.get(ReturnsService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('create', () => {
    beforeEach(() => {
      ordersRepo.findHydratedById.mockResolvedValue(mockOrder());
      filesService.findByIds.mockResolvedValue([]);
      const created = new Return();
      created.id = 'r-1';
      created.status = ReturnStatus.REQUESTED;
      returnsRepo.create.mockResolvedValue(created);
    });

    it('should create return for delivered sub-order within window', async () => {
      const result = await service.create({
        buyerId: 100,
        orderId: 'order-1',
        subOrderId: 'so-1',
        items: [{ orderItemId: 'oi-1', quantity: 1 }],
        reason: ReturnReason.DAMAGED,
      });
      expect(result.id).toBe('r-1');
      expect(returnsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          subOrderId: 'so-1',
          buyerId: 100,
          vendorId: 'vendor-1',
          reason: ReturnReason.DAMAGED,
          totalRefundMinor: '5000', // 1 × 5000
          items: [
            expect.objectContaining({
              orderItemId: 'oi-1',
              quantity: 1,
              refundAmountMinor: '5000',
            }),
          ],
          attachmentFileIds: [],
        }),
      );
    });

    it('should reject return when sub-order not delivered', async () => {
      ordersRepo.findHydratedById.mockResolvedValue(
        mockOrder({
          subOrders: [
            {
              id: 'so-1',
              vendorId: 'vendor-1',
              fulfillmentStatus: SubOrderFulfillmentStatus.AWAITING_CONFIRMATION,
              deliveredAt: null,
              items: [
                { id: 'oi-1', variantId: 'var-1', quantity: 2, unitPriceSnapshot: '5000' },
              ],
            },
          ] as never,
        }),
      );
      await expect(
        service.create({
          buyerId: 100,
          orderId: 'order-1',
          subOrderId: 'so-1',
          items: [{ orderItemId: 'oi-1', quantity: 1 }],
          reason: ReturnReason.DAMAGED,
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should reject return when window expired', async () => {
      ordersRepo.findHydratedById.mockResolvedValue(
        mockOrder({
          subOrders: [
            {
              id: 'so-1',
              vendorId: 'vendor-1',
              fulfillmentStatus: SubOrderFulfillmentStatus.DELIVERED,
              deliveredAt: new Date('2026-05-01T00:00:00Z'), // 14 days ago, > 7-day window
              items: [
                { id: 'oi-1', variantId: 'var-1', quantity: 2, unitPriceSnapshot: '5000' },
              ],
            },
          ] as never,
        }),
      );
      await expect(
        service.create({
          buyerId: 100,
          orderId: 'order-1',
          subOrderId: 'so-1',
          items: [{ orderItemId: 'oi-1', quantity: 1 }],
          reason: ReturnReason.DAMAGED,
        }),
      ).rejects.toThrow(/window/i);
    });

    it('should reject return when buyer is not the order buyer', async () => {
      await expect(
        service.create({
          buyerId: 999, // different buyer
          orderId: 'order-1',
          subOrderId: 'so-1',
          items: [{ orderItemId: 'oi-1', quantity: 1 }],
          reason: ReturnReason.DAMAGED,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject when item quantity exceeds ordered quantity', async () => {
      await expect(
        service.create({
          buyerId: 100,
          orderId: 'order-1',
          subOrderId: 'so-1',
          items: [{ orderItemId: 'oi-1', quantity: 3 }], // ordered only 2
          reason: ReturnReason.DAMAGED,
        }),
      ).rejects.toThrow(/quantity/i);
    });

    it('should reject when cumulative open returns exceed ordered quantity', async () => {
      // 1 already in non-rejected RMA. Buyer wants to return 2 more. ordered=2, total would be 3.
      returnsRepo.sumNonRejectedQuantitiesByOrderItem.mockResolvedValue(
        new Map([['oi-1', 1]]),
      );
      await expect(
        service.create({
          buyerId: 100,
          orderId: 'order-1',
          subOrderId: 'so-1',
          items: [{ orderItemId: 'oi-1', quantity: 2 }],
          reason: ReturnReason.DAMAGED,
        }),
      ).rejects.toThrow(/quantity/i);
    });

    it('should reject reason=OTHER without reasonNote', async () => {
      await expect(
        service.create({
          buyerId: 100,
          orderId: 'order-1',
          subOrderId: 'so-1',
          items: [{ orderItemId: 'oi-1', quantity: 1 }],
          reason: ReturnReason.OTHER,
        }),
      ).rejects.toThrow(/reasonNote/i);
    });

    it('should accept reason=OTHER with reasonNote', async () => {
      await service.create({
        buyerId: 100,
        orderId: 'order-1',
        subOrderId: 'so-1',
        items: [{ orderItemId: 'oi-1', quantity: 1 }],
        reason: ReturnReason.OTHER,
        reasonNote: 'Custom reason here.',
      });
      expect(returnsRepo.create).toHaveBeenCalled();
    });

    it('should reject when more than 5 attachments are provided', async () => {
      filesService.findByIds.mockResolvedValue([
        { id: 'f1' },
        { id: 'f2' },
        { id: 'f3' },
        { id: 'f4' },
        { id: 'f5' },
        { id: 'f6' },
      ] as never);
      await expect(
        service.create({
          buyerId: 100,
          orderId: 'order-1',
          subOrderId: 'so-1',
          items: [{ orderItemId: 'oi-1', quantity: 1 }],
          reason: ReturnReason.DAMAGED,
          fileIds: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'],
        }),
      ).rejects.toThrow(/5 attachments/i);
    });

    it('should reject when fileId does not exist', async () => {
      filesService.findByIds.mockResolvedValue([{ id: 'f1' }] as never);
      await expect(
        service.create({
          buyerId: 100,
          orderId: 'order-1',
          subOrderId: 'so-1',
          items: [{ orderItemId: 'oi-1', quantity: 1 }],
          reason: ReturnReason.DAMAGED,
          fileIds: ['f1', 'f-missing'],
        }),
      ).rejects.toThrow(/file/i);
    });
  });

  describe('confirmShippedBack', () => {
    it('should transition APPROVED -> SHIPPED_BACK with tracking', async () => {
      const existing = new Return();
      existing.id = 'r-1';
      existing.buyerId = 100;
      existing.status = ReturnStatus.APPROVED;
      returnsRepo.findById.mockResolvedValue(existing);
      const updated = new Return();
      updated.status = ReturnStatus.SHIPPED_BACK;
      returnsRepo.markShippedBack.mockResolvedValue(updated);

      await service.confirmShippedBack({
        buyerId: 100,
        returnId: 'r-1',
        trackingNumber: 'TRK123',
      });

      expect(returnsRepo.markShippedBack).toHaveBeenCalledWith({
        id: 'r-1',
        trackingNumber: 'TRK123',
        shippedBackAt: NOW,
      });
    });

    it('should reject buyer who does not own the return', async () => {
      const existing = new Return();
      existing.id = 'r-1';
      existing.buyerId = 999;
      existing.status = ReturnStatus.APPROVED;
      returnsRepo.findById.mockResolvedValue(existing);
      await expect(
        service.confirmShippedBack({
          buyerId: 100,
          returnId: 'r-1',
          trackingNumber: 'TRK',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject when status is not APPROVED', async () => {
      const existing = new Return();
      existing.id = 'r-1';
      existing.buyerId = 100;
      existing.status = ReturnStatus.REQUESTED;
      returnsRepo.findById.mockResolvedValue(existing);
      await expect(
        service.confirmShippedBack({
          buyerId: 100,
          returnId: 'r-1',
          trackingNumber: 'TRK',
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('vendorTransition', () => {
    const existingApproveable = (): Return => {
      const r = new Return();
      r.id = 'r-1';
      r.vendorId = 'vendor-1';
      r.subOrderId = 'so-1';
      r.status = ReturnStatus.REQUESTED;
      r.items = [
        Object.assign(
          {},
          {
            id: 'ri-1',
            returnRequestId: 'r-1',
            orderItemId: 'oi-1',
            quantity: 1,
            refundAmountMinor: '5000',
            createdAt: NOW,
          },
        ),
      ] as never;
      return r;
    };

    it('should approve REQUESTED return', async () => {
      returnsRepo.findById.mockResolvedValue(existingApproveable());
      const updated = new Return();
      updated.status = ReturnStatus.APPROVED;
      returnsRepo.markApproved.mockResolvedValue(updated);

      await service.vendorTransition({
        vendorId: 'vendor-1',
        returnId: 'r-1',
        targetStatus: ReturnStatus.APPROVED,
      });

      expect(returnsRepo.markApproved).toHaveBeenCalledWith({
        id: 'r-1',
        decidedAt: NOW,
      });
    });

    it('should reject with reason', async () => {
      returnsRepo.findById.mockResolvedValue(existingApproveable());
      const updated = new Return();
      updated.status = ReturnStatus.REJECTED;
      returnsRepo.markRejected.mockResolvedValue(updated);

      await service.vendorTransition({
        vendorId: 'vendor-1',
        returnId: 'r-1',
        targetStatus: ReturnStatus.REJECTED,
        rejectReason: 'Not eligible',
      });

      expect(returnsRepo.markRejected).toHaveBeenCalledWith({
        id: 'r-1',
        rejectReason: 'Not eligible',
        rejectedAt: NOW,
        fromStatus: ReturnStatus.REQUESTED,
      });
    });

    it('should require rejectReason on REJECTED', async () => {
      returnsRepo.findById.mockResolvedValue(existingApproveable());
      await expect(
        service.vendorTransition({
          vendorId: 'vendor-1',
          returnId: 'r-1',
          targetStatus: ReturnStatus.REJECTED,
        }),
      ).rejects.toThrow(/rejectReason/i);
    });

    it('should mark RECEIVED with restock and pass stockIncrements', async () => {
      const r = existingApproveable();
      r.status = ReturnStatus.SHIPPED_BACK;
      returnsRepo.findById.mockResolvedValue(r);
      ordersRepo.findHydratedById.mockResolvedValue({
        ...mockOrder(),
        subOrders: [
          {
            id: 'so-1',
            vendorId: 'vendor-1',
            fulfillmentStatus: SubOrderFulfillmentStatus.DELIVERED,
            deliveredAt: DELIVERED_AT,
            items: [
              {
                id: 'oi-1',
                variantId: 'var-1',
                quantity: 2,
                unitPriceSnapshot: '5000',
              },
            ],
          },
        ] as never,
      } as never);
      const updated = new Return();
      updated.status = ReturnStatus.RECEIVED;
      returnsRepo.markReceived.mockResolvedValue(updated);

      await service.vendorTransition({
        vendorId: 'vendor-1',
        returnId: 'r-1',
        targetStatus: ReturnStatus.RECEIVED,
        restock: true,
      });

      expect(returnsRepo.markReceived).toHaveBeenCalledWith({
        id: 'r-1',
        restock: true,
        receivedAt: NOW,
        stockIncrements: [{ variantId: 'var-1', delta: 1 }],
      });
    });

    it('should require restock field on RECEIVED', async () => {
      const r = existingApproveable();
      r.status = ReturnStatus.SHIPPED_BACK;
      returnsRepo.findById.mockResolvedValue(r);
      await expect(
        service.vendorTransition({
          vendorId: 'vendor-1',
          returnId: 'r-1',
          targetStatus: ReturnStatus.RECEIVED,
        }),
      ).rejects.toThrow(/restock/i);
    });

    it('should reject vendor who does not own the return (404 not 403)', async () => {
      const r = existingApproveable();
      r.vendorId = 'other-vendor';
      returnsRepo.findById.mockResolvedValue(r);
      await expect(
        service.vendorTransition({
          vendorId: 'vendor-1',
          returnId: 'r-1',
          targetStatus: ReturnStatus.APPROVED,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npm test -- src/returns/returns.service.spec.ts`
Expected: FAIL — `ReturnsService` not exported.

- [ ] **Step 3: Implement the service**

Create `src/returns/returns.service.ts`:

```ts
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { uuidv7Generate } from '../utils/uuid';
import { OrderAbstractRepository } from '../orders/infrastructure/persistence/order.abstract.repository';
import { SubOrderFulfillmentStatus } from '../orders/domain/order-enums';
import { FilesService } from '../files/files.service';
import { VendorsService } from '../vendors/vendors.service';
import { Return } from './domain/return';
import { ReturnReason, ReturnStatus } from './domain/return-enums';
import { ReturnAbstractRepository } from './infrastructure/persistence/return.abstract.repository';
import {
  assertBuyerTransition,
  assertVendorTransition,
} from './return-state-machine';

const MAX_ATTACHMENTS = 5;

export interface CreateReturnServiceInput {
  buyerId: number;
  orderId: string;
  subOrderId: string;
  items: Array<{ orderItemId: string; quantity: number }>;
  reason: ReturnReason;
  reasonNote?: string;
  fileIds?: string[];
}

export interface ConfirmShippedBackInput {
  buyerId: number;
  returnId: string;
  trackingNumber?: string;
}

export interface VendorTransitionInput {
  vendorId: string;
  returnId: string;
  targetStatus: ReturnStatus;
  rejectReason?: string;
  restock?: boolean;
}

@Injectable()
export class ReturnsService {
  constructor(
    private readonly returns: ReturnAbstractRepository,
    private readonly orders: OrderAbstractRepository,
    private readonly files: FilesService,
    private readonly vendors: VendorsService,
  ) {}

  async create(input: CreateReturnServiceInput): Promise<Return> {
    if (input.reason === ReturnReason.OTHER && !input.reasonNote?.trim()) {
      throw new UnprocessableEntityException(
        'reasonNote is required when reason is OTHER',
      );
    }
    const fileIds = input.fileIds ?? [];
    if (fileIds.length > MAX_ATTACHMENTS) {
      throw new UnprocessableEntityException(
        `At most ${MAX_ATTACHMENTS} attachments allowed`,
      );
    }
    if (fileIds.length > 0) {
      const files = await this.files.findByIds(fileIds);
      if (files.length !== fileIds.length) {
        throw new UnprocessableEntityException(
          'One or more file ids could not be found',
        );
      }
    }

    const order = await this.orders.findHydratedById(input.orderId);
    if (!order || order.buyerId !== input.buyerId) {
      throw new NotFoundException('Order not found');
    }
    const subOrder = order.subOrders?.find((s) => s.id === input.subOrderId);
    if (!subOrder) {
      throw new NotFoundException('Sub-order not found');
    }
    if (subOrder.fulfillmentStatus !== SubOrderFulfillmentStatus.DELIVERED) {
      throw new UnprocessableEntityException(
        'Sub-order must be DELIVERED to open a return',
      );
    }
    if (!subOrder.deliveredAt) {
      throw new UnprocessableEntityException(
        'Sub-order is missing a deliveredAt timestamp',
      );
    }
    const vendor = await this.vendors.getById(subOrder.vendorId);
    const windowDays = vendor.returnWindowDays ?? 0;
    const windowEndMs =
      subOrder.deliveredAt.getTime() + windowDays * 24 * 60 * 60 * 1000;
    if (Date.now() > windowEndMs) {
      throw new UnprocessableEntityException(
        `Return window of ${windowDays} day(s) has expired`,
      );
    }

    // Validate per-item quantities (≤ ordered) and cumulative (existing
    // non-rejected returns + this request ≤ ordered).
    const orderedByItemId = new Map<string, { qty: number; variantId: string; unitPriceMinor: string }>();
    for (const item of subOrder.items ?? []) {
      orderedByItemId.set(item.id, {
        qty: item.quantity,
        variantId: item.variantId,
        unitPriceMinor: item.unitPriceSnapshot,
      });
    }
    for (const ri of input.items) {
      const ordered = orderedByItemId.get(ri.orderItemId);
      if (!ordered) {
        throw new UnprocessableEntityException(
          `orderItemId ${ri.orderItemId} not in sub-order ${input.subOrderId}`,
        );
      }
      if (ri.quantity > ordered.qty) {
        throw new UnprocessableEntityException(
          `quantity ${ri.quantity} exceeds ordered ${ordered.qty} for item ${ri.orderItemId}`,
        );
      }
    }

    const orderItemIds = input.items.map((i) => i.orderItemId);
    const existingByItem =
      await this.returns.sumNonRejectedQuantitiesByOrderItem({
        orderItemIds,
      });
    for (const ri of input.items) {
      const ordered = orderedByItemId.get(ri.orderItemId)!;
      const existing = existingByItem.get(ri.orderItemId) ?? 0;
      if (existing + ri.quantity > ordered.qty) {
        throw new UnprocessableEntityException(
          `cumulative return quantity (${existing + ri.quantity}) exceeds ordered (${ordered.qty}) for item ${ri.orderItemId}`,
        );
      }
    }

    // Compute refund amounts
    const itemsWithIds = input.items.map((ri) => {
      const ordered = orderedByItemId.get(ri.orderItemId)!;
      const refundAmountMinor = (
        BigInt(ordered.unitPriceMinor) * BigInt(ri.quantity)
      ).toString();
      return {
        id: uuidv7Generate(),
        orderItemId: ri.orderItemId,
        quantity: ri.quantity,
        refundAmountMinor,
      };
    });
    const totalRefundMinor = itemsWithIds
      .reduce((acc, i) => acc + BigInt(i.refundAmountMinor), 0n)
      .toString();

    return this.returns.create({
      id: uuidv7Generate(),
      subOrderId: input.subOrderId,
      buyerId: input.buyerId,
      vendorId: subOrder.vendorId,
      reason: input.reason,
      reasonNote: input.reasonNote?.trim() ?? null,
      totalRefundMinor,
      items: itemsWithIds,
      attachmentFileIds: fileIds,
    });
  }

  async getByIdForBuyer(buyerId: number, returnId: string): Promise<Return> {
    const r = await this.returns.findById(returnId);
    if (!r || r.buyerId !== buyerId) {
      throw new NotFoundException('Return not found');
    }
    return r;
  }

  async getByIdForVendor(vendorId: string, returnId: string): Promise<Return> {
    const r = await this.returns.findById(returnId);
    if (!r || r.vendorId !== vendorId) {
      throw new NotFoundException('Return not found');
    }
    return r;
  }

  async getByIdForAdmin(returnId: string): Promise<Return> {
    const r = await this.returns.findById(returnId);
    if (!r) throw new NotFoundException('Return not found');
    return r;
  }

  async confirmShippedBack(input: ConfirmShippedBackInput): Promise<Return> {
    const existing = await this.getByIdForBuyer(input.buyerId, input.returnId);
    assertBuyerTransition(existing.status, ReturnStatus.SHIPPED_BACK);
    return this.returns.markShippedBack({
      id: input.returnId,
      trackingNumber: input.trackingNumber?.trim() ?? null,
      shippedBackAt: new Date(),
    });
  }

  async vendorTransition(input: VendorTransitionInput): Promise<Return> {
    const existing = await this.getByIdForVendor(
      input.vendorId,
      input.returnId,
    );
    assertVendorTransition(existing.status, input.targetStatus);

    const now = new Date();
    switch (input.targetStatus) {
      case ReturnStatus.APPROVED:
        return this.returns.markApproved({
          id: input.returnId,
          decidedAt: now,
        });

      case ReturnStatus.REJECTED:
        if (!input.rejectReason?.trim()) {
          throw new UnprocessableEntityException(
            'rejectReason is required when rejecting a return',
          );
        }
        return this.returns.markRejected({
          id: input.returnId,
          rejectReason: input.rejectReason.trim(),
          rejectedAt: now,
          fromStatus: existing.status,
        });

      case ReturnStatus.RECEIVED: {
        if (input.restock === undefined) {
          throw new UnprocessableEntityException(
            'restock is required when transitioning to RECEIVED',
          );
        }
        const stockIncrements = input.restock
          ? await this.computeStockIncrements(existing)
          : [];
        return this.returns.markReceived({
          id: input.returnId,
          restock: input.restock,
          receivedAt: now,
          stockIncrements,
        });
      }

      case ReturnStatus.REFUNDED:
        return this.returns.markRefunded({
          id: input.returnId,
          refundedAt: now,
        });

      case ReturnStatus.CLOSED: {
        const closed = await this.returns.markClosed({
          id: input.returnId,
          closedAt: now,
        });
        await this.tryFlipSubOrderToReturned(closed.subOrderId);
        return closed;
      }

      default:
        throw new UnprocessableEntityException(
          `Unsupported transition target: ${input.targetStatus}`,
        );
    }
  }

  /**
   * Compute (variantId, delta) pairs for the return's items by joining each
   * return_item's order_item_id back to the parent sub-order's items
   * (loaded via the orders repo). Empty if items can't be reconciled.
   */
  private async computeStockIncrements(
    r: Return,
  ): Promise<Array<{ variantId: string; delta: number }>> {
    const order = await this.findOrderForSubOrder(r.subOrderId);
    if (!order) return [];
    const subOrder = order.subOrders?.find((s) => s.id === r.subOrderId);
    if (!subOrder) return [];
    const variantById = new Map<string, string>();
    for (const oi of subOrder.items ?? []) variantById.set(oi.id, oi.variantId);
    return r.items
      .map((ri) => {
        const variantId = variantById.get(ri.orderItemId);
        return variantId
          ? { variantId, delta: ri.quantity }
          : null;
      })
      .filter((x): x is { variantId: string; delta: number } => x !== null);
  }

  /**
   * Loads the parent order by walking sub-order → order. The orders repo
   * exposes findHydratedById(orderId), so we need to know orderId. We
   * piggyback on a small helper that looks up the sub-order's order id.
   * Implementation reads `Return.subOrderId` and the orders repo's hydrated
   * fetch; an additional `findOrderIdForSubOrder` could be added later if
   * this becomes a hotspot.
   */
  private async findOrderForSubOrder(subOrderId: string) {
    // Returns repository doesn't expose subOrder→order lookup directly.
    // We use a single SQL fallback via the orders repo's existing
    // findHydratedById path — but that requires an orderId. Instead, we
    // load the sub-order by id from the order events join. For now use
    // the simpler approach: query through an injected repository.
    //
    // Since this method is only called during the RECEIVED transition,
    // we keep it lightweight: the order repo exposes
    // `findHydratedById(orderId)`. We resolve orderId from the sub-order
    // by adding a thin `findSubOrderOrderId(subOrderId)` method later if
    // needed. For 10a scope, we delegate through a typed helper passed
    // into the service via a future repo method.
    //
    // Until that helper exists, we'll fail soft and return null —
    // downstream the empty stockIncrements just means no restock happens.
    // This is a temporary YAGNI shortcut; the code below will be replaced
    // when Task 8b adds an `OrderAbstractRepository.findOrderIdForSubOrder`.
    void subOrderId;
    return null;
  }

  private async tryFlipSubOrderToReturned(subOrderId: string): Promise<void> {
    // YAGNI for 10a: implementation lands in Task 9 (sub-order auto-flip)
    void subOrderId;
  }
}
```

The `findOrderForSubOrder` and `tryFlipSubOrderToReturned` private helpers are stubbed in this task. Task 9 fleshes them out by adding the missing repository methods.

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- src/returns/returns.service.spec.ts`

Expected: all tests pass EXCEPT the `RECEIVED` test that asserts `stockIncrements: [{ variantId: 'var-1', delta: 1 }]`. That one will fail because `computeStockIncrements` returns `[]`. Mark this test with `it.skip(...)` for now — Task 9 unskips it.

Replace `it('should mark RECEIVED with restock and pass stockIncrements', ...)` with `it.skip('should mark RECEIVED with restock and pass stockIncrements', ...)`.

Run: `npm test -- src/returns/returns.service.spec.ts`
Expected: 16 tests pass, 1 skipped.

- [ ] **Step 5: Commit**

```bash
git add src/returns/returns.service.ts src/returns/returns.service.spec.ts
git commit -m "feat(returns): service with create + buyer/vendor transitions (stock+sub-order auto-flip stubbed)"
```

---

## Task 9: Wire stock-increment + sub-order auto-flip

**Files:**
- Modify: `src/orders/infrastructure/persistence/order.abstract.repository.ts`
- Modify: `src/orders/infrastructure/persistence/relational/repositories/order.repository.ts`
- Modify: `src/returns/returns.service.ts`
- Modify: `src/returns/returns.service.spec.ts`

- [ ] **Step 1: Add abstract method**

Modify `src/orders/infrastructure/persistence/order.abstract.repository.ts` — append to the abstract class:

```ts
  /**
   * Returns the orderId for a given subOrderId, or null if not found.
   * Used by the returns service to hydrate the parent order during
   * the RECEIVED transition.
   */
  abstract findOrderIdForSubOrder(subOrderId: string): Promise<string | null>;

  /**
   * Atomically flips a sub-order's fulfillmentStatus to RETURNED if and
   * only if it is currently DELIVERED. Returns true if the flip happened.
   */
  abstract flipSubOrderToReturnedIfDelivered(
    subOrderId: string,
  ): Promise<boolean>;
```

- [ ] **Step 2: Implement them**

Modify `src/orders/infrastructure/persistence/relational/repositories/order.repository.ts` — add inside the class:

```ts
  async findOrderIdForSubOrder(subOrderId: string): Promise<string | null> {
    const row = await this.dataSource
      .getRepository(SubOrderEntity)
      .findOne({ where: { id: subOrderId }, select: { orderId: true } });
    return row?.orderId ?? null;
  }

  async flipSubOrderToReturnedIfDelivered(
    subOrderId: string,
  ): Promise<boolean> {
    const result = await this.dataSource
      .getRepository(SubOrderEntity)
      .createQueryBuilder()
      .update()
      .set({ fulfillmentStatus: SubOrderFulfillmentStatus.RETURNED })
      .where('id = :id', { id: subOrderId })
      .andWhere('fulfillment_status = :delivered', {
        delivered: SubOrderFulfillmentStatus.DELIVERED,
      })
      .execute();
    return (result.affected ?? 0) > 0;
  }
```

Make sure `SubOrderFulfillmentStatus` is imported at the top of the file (it should already be).

- [ ] **Step 3: Wire into the service**

Replace `findOrderForSubOrder` and `tryFlipSubOrderToReturned` in `src/returns/returns.service.ts` with real implementations.

`computeStockIncrements`:

```ts
private async computeStockIncrements(
  r: Return,
): Promise<Array<{ variantId: string; delta: number }>> {
  const orderId = await this.orders.findOrderIdForSubOrder(r.subOrderId);
  if (!orderId) return [];
  const order = await this.orders.findHydratedById(orderId);
  if (!order) return [];
  const subOrder = order.subOrders?.find((s) => s.id === r.subOrderId);
  if (!subOrder) return [];
  const variantById = new Map<string, string>();
  for (const oi of subOrder.items ?? []) variantById.set(oi.id, oi.variantId);
  return r.items
    .map((ri) => {
      const variantId = variantById.get(ri.orderItemId);
      return variantId ? { variantId, delta: ri.quantity } : null;
    })
    .filter((x): x is { variantId: string; delta: number } => x !== null);
}
```

(Remove the old `findOrderForSubOrder` helper — its logic moves into `computeStockIncrements`.)

`tryFlipSubOrderToReturned`:

```ts
private async tryFlipSubOrderToReturned(subOrderId: string): Promise<void> {
  const orderId = await this.orders.findOrderIdForSubOrder(subOrderId);
  if (!orderId) return;
  const order = await this.orders.findHydratedById(orderId);
  if (!order) return;
  const subOrder = order.subOrders?.find((s) => s.id === subOrderId);
  if (!subOrder) return;

  // Sum closed-RMA quantities by orderItemId. Only CLOSED returns count
  // toward "fully returned" — REJECTED never counts; in-progress states
  // (REQUESTED..REFUNDED) don't yet finalize the loss.
  const orderItemIds = (subOrder.items ?? []).map((oi) => oi.id);
  if (orderItemIds.length === 0) return;
  const closedSums = await this.returns.sumClosedQuantitiesByOrderItem({
    orderItemIds,
  });

  const allReturned = (subOrder.items ?? []).every((oi) => {
    return (closedSums.get(oi.id) ?? 0) >= oi.quantity;
  });
  if (allReturned) {
    await this.orders.flipSubOrderToReturnedIfDelivered(subOrderId);
  }
}
```

- [ ] **Step 4: Add `sumClosedQuantitiesByOrderItem` to returns repo**

Modify `src/returns/infrastructure/persistence/return.abstract.repository.ts` — add to the abstract class:

```ts
  /**
   * Like sumNonRejectedQuantitiesByOrderItem but only counts CLOSED returns.
   * Used to determine whether all items of a sub-order have been fully
   * returned and the sub-order should flip to RETURNED.
   */
  abstract sumClosedQuantitiesByOrderItem(
    input: CountOpenForOrderItemsInput,
  ): Promise<Map<string, number>>;
```

Modify `src/returns/infrastructure/persistence/relational/repositories/return.repository.ts` — add the method:

```ts
async sumClosedQuantitiesByOrderItem(
  input: CountOpenForOrderItemsInput,
): Promise<Map<string, number>> {
  if (input.orderItemIds.length === 0) return new Map();
  const rows = await this.dataSource
    .getRepository(ReturnItemEntity)
    .createQueryBuilder('ri')
    .innerJoin('ri.returnRequest', 'rr')
    .select('ri.order_item_id', 'orderItemId')
    .addSelect('COALESCE(SUM(ri.quantity), 0)', 'qty')
    .where('ri.order_item_id IN (:...ids)', { ids: input.orderItemIds })
    .andWhere('rr.status = :closed', { closed: ReturnStatus.CLOSED })
    .groupBy('ri.order_item_id')
    .getRawMany<{ orderItemId: string; qty: string }>();
  return new Map(rows.map((r) => [r.orderItemId, Number(r.qty)]));
}
```

- [ ] **Step 5: Un-skip the RECEIVED test + add the auto-flip test**

In `src/returns/returns.service.spec.ts`:

a) Change `it.skip(...)` back to `it(...)` for the RECEIVED + stockIncrements test.

b) Add this test inside `describe('vendorTransition', ...)`:

```ts
it('should auto-flip sub-order to RETURNED when all items closed', async () => {
  const r = existingApproveable();
  r.status = ReturnStatus.REFUNDED;
  returnsRepo.findById.mockResolvedValue(r);
  returnsRepo.markClosed.mockResolvedValue({
    ...r,
    status: ReturnStatus.CLOSED,
    subOrderId: 'so-1',
  } as never);
  ordersRepo.findOrderIdForSubOrder = jest
    .fn()
    .mockResolvedValue('order-1');
  ordersRepo.findHydratedById = jest
    .fn()
    .mockResolvedValue(mockOrder({
      subOrders: [
        {
          id: 'so-1',
          vendorId: 'vendor-1',
          fulfillmentStatus: SubOrderFulfillmentStatus.DELIVERED,
          deliveredAt: DELIVERED_AT,
          items: [
            { id: 'oi-1', variantId: 'var-1', quantity: 2, unitPriceSnapshot: '5000' },
          ],
        },
      ] as never,
    }));
  returnsRepo.sumClosedQuantitiesByOrderItem = jest
    .fn()
    .mockResolvedValue(new Map([['oi-1', 2]]));
  ordersRepo.flipSubOrderToReturnedIfDelivered = jest
    .fn()
    .mockResolvedValue(true);

  await service.vendorTransition({
    vendorId: 'vendor-1',
    returnId: 'r-1',
    targetStatus: ReturnStatus.CLOSED,
  });

  expect(ordersRepo.flipSubOrderToReturnedIfDelivered).toHaveBeenCalledWith(
    'so-1',
  );
});

it('should not flip sub-order when only partial items closed', async () => {
  const r = existingApproveable();
  r.status = ReturnStatus.REFUNDED;
  returnsRepo.findById.mockResolvedValue(r);
  returnsRepo.markClosed.mockResolvedValue({
    ...r,
    status: ReturnStatus.CLOSED,
    subOrderId: 'so-1',
  } as never);
  ordersRepo.findOrderIdForSubOrder = jest
    .fn()
    .mockResolvedValue('order-1');
  ordersRepo.findHydratedById = jest.fn().mockResolvedValue(
    mockOrder({
      subOrders: [
        {
          id: 'so-1',
          vendorId: 'vendor-1',
          fulfillmentStatus: SubOrderFulfillmentStatus.DELIVERED,
          deliveredAt: DELIVERED_AT,
          items: [
            { id: 'oi-1', variantId: 'var-1', quantity: 2, unitPriceSnapshot: '5000' },
          ],
        },
      ] as never,
    }),
  );
  returnsRepo.sumClosedQuantitiesByOrderItem = jest
    .fn()
    .mockResolvedValue(new Map([['oi-1', 1]]));
  ordersRepo.flipSubOrderToReturnedIfDelivered = jest
    .fn()
    .mockResolvedValue(false);

  await service.vendorTransition({
    vendorId: 'vendor-1',
    returnId: 'r-1',
    targetStatus: ReturnStatus.CLOSED,
  });

  expect(ordersRepo.flipSubOrderToReturnedIfDelivered).not.toHaveBeenCalled();
});
```

c) Update the mocks in `beforeEach`:

```ts
returnsRepo = {
  ...existing fields...,
  sumClosedQuantitiesByOrderItem: jest.fn().mockResolvedValue(new Map()),
} as unknown as jest.Mocked<ReturnAbstractRepository>;

ordersRepo = {
  findHydratedById: jest.fn(),
  findOrderIdForSubOrder: jest.fn(),
  flipSubOrderToReturnedIfDelivered: jest.fn(),
} as unknown as jest.Mocked<OrderAbstractRepository>;
```

- [ ] **Step 6: Run tests**

Run: `npm test -- src/returns/returns.service.spec.ts`
Expected: all tests pass (no skips), with the two new auto-flip tests included.

- [ ] **Step 7: Commit**

```bash
git add src/orders/infrastructure/persistence/order.abstract.repository.ts \
        src/orders/infrastructure/persistence/relational/repositories/order.repository.ts \
        src/returns/returns.service.ts \
        src/returns/returns.service.spec.ts \
        src/returns/infrastructure/persistence/return.abstract.repository.ts \
        src/returns/infrastructure/persistence/relational/repositories/return.repository.ts
git commit -m "feat(returns): wire stock increments + sub-order auto-flip on full return"
```

---

## Task 10: Buyer controller

**Files:**
- Create: `src/returns/returns.controller.ts`

- [ ] **Step 1: Controller**

Create `src/returns/returns.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { ConfirmShippedBackDto } from './dto/confirm-shipped-back.dto';
import { CreateReturnDto } from './dto/create-return.dto';
import { ReturnResponseDto } from './dto/return-response.dto';
import { ReturnStatus } from './domain/return-enums';
import { ReturnsService } from './returns.service';

@ApiTags('Buyer · Returns')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller({ version: '1' })
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Post('orders/:orderId/suborders/:subOrderId/returns')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: ReturnResponseDto })
  async create(
    @Req() req: Request,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('subOrderId', ParseUUIDPipe) subOrderId: string,
    @Body() dto: CreateReturnDto,
  ): Promise<ReturnResponseDto> {
    const buyerId = (req.user as { id: number }).id;
    const created = await this.returns.create({
      buyerId,
      orderId,
      subOrderId,
      items: dto.items,
      reason: dto.reason,
      reasonNote: dto.reasonNote,
      fileIds: dto.fileIds,
    });
    return ReturnResponseDto.from(created);
  }

  @Get('returns')
  @ApiOkResponse({ type: ReturnResponseDto, isArray: true })
  async listMine(
    @Req() req: Request,
    @Query('subOrderId') subOrderId?: string,
    @Query('status') status?: ReturnStatus,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ): Promise<{ data: ReturnResponseDto[]; total: number }> {
    const buyerId = (req.user as { id: number }).id;
    const result = await this.returns.listForBuyer({
      buyerId,
      subOrderId,
      status,
      page: Math.max(1, Number(page) || 1),
      limit: Math.min(100, Math.max(1, Number(limit) || 20)),
    });
    return {
      data: result.data.map(ReturnResponseDto.from),
      total: result.total,
    };
  }

  @Get('returns/:id')
  @ApiOkResponse({ type: ReturnResponseDto })
  async getById(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReturnResponseDto> {
    const buyerId = (req.user as { id: number }).id;
    const r = await this.returns.getByIdForBuyer(buyerId, id);
    return ReturnResponseDto.from(r);
  }

  @Patch('returns/:id/shipped-back')
  @ApiOkResponse({ type: ReturnResponseDto })
  async confirmShippedBack(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmShippedBackDto,
  ): Promise<ReturnResponseDto> {
    const buyerId = (req.user as { id: number }).id;
    const r = await this.returns.confirmShippedBack({
      buyerId,
      returnId: id,
      trackingNumber: dto.trackingNumber,
    });
    return ReturnResponseDto.from(r);
  }
}
```

- [ ] **Step 2: Add `listForBuyer` to the service**

Modify `src/returns/returns.service.ts` — add inside the class:

```ts
async listForBuyer(opts: {
  buyerId: number;
  subOrderId?: string;
  status?: ReturnStatus;
  page: number;
  limit: number;
}): Promise<{ data: Return[]; total: number }> {
  return this.returns.listForBuyer(opts);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/returns/returns.controller.ts src/returns/returns.service.ts
git commit -m "feat(returns): buyer-facing controller (POST + GET + ship-back PATCH)"
```

---

## Task 11: Vendor controller

**Files:**
- Create: `src/returns/vendor-returns.controller.ts`

- [ ] **Step 1: Controller**

Create `src/returns/vendor-returns.controller.ts`:

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
import { ProductsService } from '../products/products.service';
import { ReturnStatus } from './domain/return-enums';
import { ReturnResponseDto } from './dto/return-response.dto';
import { TransitionReturnDto } from './dto/transition-return.dto';
import { ReturnsService } from './returns.service';

@ApiTags('Vendor · Returns')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'vendor/returns', version: '1' })
export class VendorReturnsController {
  constructor(
    private readonly returns: ReturnsService,
    private readonly products: ProductsService,
  ) {}

  @Get()
  @ApiOkResponse({ type: ReturnResponseDto, isArray: true })
  async list(
    @Req() req: Request,
    @Query('subOrderId') subOrderId?: string,
    @Query('status') status?: ReturnStatus,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ): Promise<{ data: ReturnResponseDto[]; total: number }> {
    const userId = (req.user as { id: number }).id;
    const vendor = await this.products.getCallingActiveVendor(userId);
    const result = await this.returns.listForVendor({
      vendorId: vendor.id,
      subOrderId,
      status,
      page: Math.max(1, Number(page) || 1),
      limit: Math.min(100, Math.max(1, Number(limit) || 20)),
    });
    return {
      data: result.data.map(ReturnResponseDto.from),
      total: result.total,
    };
  }

  @Get(':id')
  @ApiOkResponse({ type: ReturnResponseDto })
  async getById(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReturnResponseDto> {
    const userId = (req.user as { id: number }).id;
    const vendor = await this.products.getCallingActiveVendor(userId);
    const r = await this.returns.getByIdForVendor(vendor.id, id);
    return ReturnResponseDto.from(r);
  }

  @Patch(':id')
  @ApiOkResponse({ type: ReturnResponseDto })
  async transition(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionReturnDto,
  ): Promise<ReturnResponseDto> {
    const userId = (req.user as { id: number }).id;
    const vendor = await this.products.getCallingActiveVendor(userId);
    const r = await this.returns.vendorTransition({
      vendorId: vendor.id,
      returnId: id,
      targetStatus: dto.status,
      rejectReason: dto.rejectReason,
      restock: dto.restock,
    });
    return ReturnResponseDto.from(r);
  }
}
```

- [ ] **Step 2: Add `listForVendor` to the service**

Modify `src/returns/returns.service.ts` — add inside the class:

```ts
async listForVendor(opts: {
  vendorId: string;
  subOrderId?: string;
  status?: ReturnStatus;
  page: number;
  limit: number;
}): Promise<{ data: Return[]; total: number }> {
  return this.returns.listForVendor(opts);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/returns/vendor-returns.controller.ts src/returns/returns.service.ts
git commit -m "feat(returns): vendor controller for list + get + transition"
```

---

## Task 12: Admin controller

**Files:**
- Create: `src/returns/admin-returns.controller.ts`

- [ ] **Step 1: Inspect existing admin guard pattern**

Run: `grep -l "Roles\|RoleGuard\|admin" src/admin-audit-log/*.controller.ts`

Read the file(s) printed and note the decorator pattern used to gate admin-only routes (likely `@Roles(RoleEnum.admin)` + `@UseGuards(AuthGuard('jwt'), RolesGuard)`). Use the same pattern in the controller below.

- [ ] **Step 2: Controller**

Create `src/returns/admin-returns.controller.ts`:

```ts
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../roles/roles.decorator';
import { RoleEnum } from '../roles/roles.enum';
import { RolesGuard } from '../roles/roles.guard';
import { ReturnStatus } from './domain/return-enums';
import { ReturnResponseDto } from './dto/return-response.dto';
import { ReturnsService } from './returns.service';

@ApiTags('Admin · Returns')
@ApiBearerAuth('jwt')
@Roles(RoleEnum.admin)
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller({ path: 'admin/returns', version: '1' })
export class AdminReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Get()
  @ApiOkResponse({ type: ReturnResponseDto, isArray: true })
  async list(
    @Query('vendorId') vendorId?: string,
    @Query('buyerId') buyerId?: string,
    @Query('status') status?: ReturnStatus,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ): Promise<{ data: ReturnResponseDto[]; total: number }> {
    const result = await this.returns.listForAdmin({
      vendorId,
      buyerId: buyerId !== undefined ? Number(buyerId) : undefined,
      status,
      page: Math.max(1, Number(page) || 1),
      limit: Math.min(100, Math.max(1, Number(limit) || 20)),
    });
    return {
      data: result.data.map(ReturnResponseDto.from),
      total: result.total,
    };
  }

  @Get(':id')
  @ApiOkResponse({ type: ReturnResponseDto })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReturnResponseDto> {
    const r = await this.returns.getByIdForAdmin(id);
    return ReturnResponseDto.from(r);
  }
}
```

If the actual guard import paths differ from what's shown (`../roles/roles.decorator`, `../roles/roles.enum`, `../roles/roles.guard`), adjust based on what `src/roles/` actually exports — confirmed at file creation time.

- [ ] **Step 3: Add `listForAdmin` to the service**

Modify `src/returns/returns.service.ts` — add inside the class:

```ts
async listForAdmin(opts: {
  vendorId?: string;
  buyerId?: number;
  status?: ReturnStatus;
  page: number;
  limit: number;
}): Promise<{ data: Return[]; total: number }> {
  return this.returns.listForAdmin(opts);
}
```

- [ ] **Step 4: Commit**

```bash
git add src/returns/admin-returns.controller.ts src/returns/returns.service.ts
git commit -m "feat(returns): admin read-only listing + detail"
```

---

## Task 13: Module wiring

**Files:**
- Create: `src/returns/returns.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Returns module**

Create `src/returns/returns.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { FilesModule } from '../files/files.module';
import { VendorsModule } from '../vendors/vendors.module';
import { ProductsModule } from '../products/products.module';
import { AdminReturnsController } from './admin-returns.controller';
import { RelationalReturnPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';
import { VendorReturnsController } from './vendor-returns.controller';

@Module({
  imports: [
    RelationalReturnPersistenceModule,
    OrdersModule,
    FilesModule,
    VendorsModule,
    ProductsModule,
  ],
  controllers: [
    ReturnsController,
    VendorReturnsController,
    AdminReturnsController,
  ],
  providers: [ReturnsService],
  exports: [ReturnsService],
})
export class ReturnsModule {}
```

- [ ] **Step 2: Register in AppModule**

Modify `src/app.module.ts`:

a) Add `import { ReturnsModule } from './returns/returns.module';` alphabetically (between `RegionsModule` and `RequestContextModule` or similar — match existing alphabetical placement).

b) Add `ReturnsModule,` to the `imports: [...]` array, alphabetically (after `OrdersModule`, before `ReviewsModule`).

- [ ] **Step 3: Boot test**

Run: `npm run build`
Expected: clean compile, no DI errors.

Run: `npm run start:dev` for ~10 seconds, then Ctrl-C.
Expected: server boots without DI errors. Look for the Swagger output line.

- [ ] **Step 4: Commit**

```bash
git add src/returns/returns.module.ts src/app.module.ts
git commit -m "feat(returns): wire ReturnsModule into AppModule"
```

---

## Task 14: E2E happy path

**Files:**
- Create: `test/returns/returns.e2e-spec.ts`

- [ ] **Step 1: Read existing e2e patterns**

Read `test/orders/orders.e2e-spec.ts` and `test/orders/fulfillment.e2e-spec.ts` in full. The new spec must reuse the same fixture style: `request(APP_URL)` against the Docker-running app; vendor signup → admin approval → product create → variants → buyer signup → cart → place COD order → vendor advances suborder through CONFIRMED/PACKED/SHIPPED → buyer confirms delivery → suborder is DELIVERED.

- [ ] **Step 2: Write the e2e spec**

Create `test/returns/returns.e2e-spec.ts`:

```ts
import request from 'supertest';
import { ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL } from '../utils/constants';

describe('Returns / RMA (e2e)', () => {
  const ts = Date.now();
  const vendorEmail = `rma-vendor-${ts}@example.com`;
  const vendorPassword = 'Pass1234!';
  const buyerEmail = `rma-buyer-${ts}@example.com`;
  const buyerPassword = 'Pass1234!';
  const shopName = `RMA Shop ${ts}`;
  const productSlug = `rma-tee-${ts}`;

  let adminToken = '';
  let vendorToken = '';
  let buyerToken = '';
  let vendorId = '';
  let variantId = '';
  let orderId = '';
  let subOrderId = '';
  let orderItemId = '';
  let returnId = '';

  const saAddress = {
    fullName: 'RMA Buyer',
    phone: '+966555077777',
    country: 'SA',
    region: 'Riyadh',
    city: 'Riyadh',
    postalCode: '12345',
    street: 'Test st 7',
    notes: null,
  };

  const validKey = (label: string) =>
    `idem-${label}-${ts}-xxxxxxxxxxxxx`.slice(0, 64);

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
        firstName: 'RMA',
        lastName: 'Vendor',
        shopName,
      });
    vendorId = vendorSignup.body.vendor.id;

    await request(APP_URL)
      .patch(`/api/v1/admin/vendors/${vendorId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);

    // Set the vendor's return window to a comfortable 30 days.
    await request(APP_URL)
      .patch(`/api/v1/admin/vendors/${vendorId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ returnWindowDays: 30 });

    const vendorLogin = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: vendorEmail, password: vendorPassword });
    vendorToken = vendorLogin.body.token;

    const product = await request(APP_URL)
      .post('/api/v1/vendor/products')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        slug: productSlug,
        nameTranslations: { en: 'RMA Tee', ar: 'تي شيرت' },
        descriptionTranslations: { en: 'A tee for RMA testing.' },
        baseCurrency: 'SAR',
        supportedRegionCodes: ['SA'],
      });
    const productId = product.body.id;

    const generated = await request(APP_URL)
      .post(`/api/v1/vendor/products/${productId}/variants/generate`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ optionTypes: [] });
    variantId = generated.body.variants?.[0]?.id ?? generated.body[0]?.id;

    const regions = await request(APP_URL).get('/api/v1/regions');
    const saRegion = regions.body.data.find(
      (r: { code: string }) => r.code === 'SA',
    );

    await request(APP_URL)
      .post(`/api/v1/vendor/products/${productId}/variants/${variantId}/prices`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ regionId: saRegion.id, priceMinorUnits: '5000' });

    await request(APP_URL)
      .patch(`/api/v1/vendor/variants/${variantId}/stock`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ quantity: 50 });

    await request(APP_URL)
      .post(`/api/v1/vendor/products/${productId}/publish`)
      .set('Authorization', `Bearer ${vendorToken}`);

    await request(APP_URL)
      .post('/api/v1/vendor/shipping-zones')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        name: 'SA standard',
        countryCodes: ['SA'],
        costMinorUnits: '0',
        currencyCode: 'SAR',
        estDeliveryDaysMin: 1,
        estDeliveryDaysMax: 3,
      });

    await request(APP_URL)
      .post('/api/v1/auth/email/register')
      .send({
        email: buyerEmail,
        password: buyerPassword,
        firstName: 'RMA',
        lastName: 'Buyer',
      });

    const buyerLogin = await request(APP_URL)
      .post('/api/v1/auth/email/login')
      .send({ email: buyerEmail, password: buyerPassword });
    buyerToken = buyerLogin.body.token;

    await request(APP_URL)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ variantId, quantity: 2 });

    const place = await request(APP_URL)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('Idempotency-Key', validKey('place'))
      .send({ address: saAddress, paymentMethod: 'COD' });
    orderId = place.body.id;
    subOrderId = place.body.subOrders[0].id;
    orderItemId = place.body.subOrders[0].items[0].id;

    // Drive the sub-order through the fulfillment states.
    for (const target of ['CONFIRMED', 'PACKED', 'SHIPPED']) {
      await request(APP_URL)
        .patch(`/api/v1/vendor/suborders/${subOrderId}/status`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ status: target });
    }

    // Buyer confirms delivery → sub-order = DELIVERED.
    await request(APP_URL)
      .post(`/api/v1/orders/${orderId}/suborders/${subOrderId}/confirm-delivery`)
      .set('Authorization', `Bearer ${buyerToken}`);
  }, 120000);

  it('should walk through the full RMA happy path with auto-flip to RETURNED', async () => {
    // 1. Buyer creates an RMA for both ordered units.
    const create = await request(APP_URL)
      .post(`/api/v1/orders/${orderId}/suborders/${subOrderId}/returns`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        items: [{ orderItemId, quantity: 2 }],
        reason: 'DAMAGED',
        reasonNote: 'Both arrived damaged.',
      });
    expect(create.status).toBe(201);
    expect(create.body.status).toBe('REQUESTED');
    returnId = create.body.id;

    // 2. Vendor approves.
    const approve = await request(APP_URL)
      .patch(`/api/v1/vendor/returns/${returnId}`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: 'APPROVED' });
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe('APPROVED');

    // 3. Buyer ships back with tracking.
    const ship = await request(APP_URL)
      .patch(`/api/v1/returns/${returnId}/shipped-back`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ trackingNumber: 'TRK-XYZ-1' });
    expect(ship.status).toBe(200);
    expect(ship.body.status).toBe('SHIPPED_BACK');
    expect(ship.body.returnTrackingNumber).toBe('TRK-XYZ-1');

    // 4. Vendor confirms RECEIVED with restock.
    const recv = await request(APP_URL)
      .patch(`/api/v1/vendor/returns/${returnId}`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: 'RECEIVED', restock: true });
    expect(recv.status).toBe(200);
    expect(recv.body.status).toBe('RECEIVED');
    expect(recv.body.restocked).toBe(true);

    // 5. Vendor marks REFUNDED.
    const refund = await request(APP_URL)
      .patch(`/api/v1/vendor/returns/${returnId}`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: 'REFUNDED' });
    expect(refund.status).toBe(200);
    expect(refund.body.status).toBe('REFUNDED');

    // 6. Vendor closes.
    const close = await request(APP_URL)
      .patch(`/api/v1/vendor/returns/${returnId}`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: 'CLOSED' });
    expect(close.status).toBe(200);
    expect(close.body.status).toBe('CLOSED');

    // 7. Sub-order should auto-flip to RETURNED.
    const order = await request(APP_URL)
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(order.status).toBe(200);
    const so = order.body.subOrders.find((s: { id: string }) => s.id === subOrderId);
    expect(so.fulfillmentStatus).toBe('RETURNED');
  }, 60000);
});
```

- [ ] **Step 3: Run the spec via the Docker e2e flow**

Run: `npm run test:e2e:relational:docker -- --testPathPatterns="test/returns"` (or whatever invocation pattern your repo uses for the docker e2e). If your local setup runs the test directly against an already-running app, use: `npm run test:e2e -- --testPathPatterns="test/returns"`.

Expected: 1 test passes.

- [ ] **Step 4: Commit**

```bash
git add test/returns/returns.e2e-spec.ts
git commit -m "test(returns): e2e happy path (request -> approve -> ship-back -> received -> refunded -> closed -> sub-order RETURNED)"
```

---

## Task 15: E2E edge cases

**Files:**
- Modify: `test/returns/returns.e2e-spec.ts`

- [ ] **Step 1: Add edge-case tests**

Append to the same `describe` block in `test/returns/returns.e2e-spec.ts`:

```ts
it('should reject a return on a sub-order that is not DELIVERED', async () => {
  // Use a fresh sub-order — register a second buyer, place + leave AWAITING_CONFIRMATION
  const ts2 = Date.now();
  const buyer2Email = `rma-buyer2-${ts2}@example.com`;
  const buyer2Password = 'Pass1234!';
  await request(APP_URL).post('/api/v1/auth/email/register').send({
    email: buyer2Email,
    password: buyer2Password,
    firstName: 'Buyer2',
    lastName: 'Test',
  });
  const login = await request(APP_URL)
    .post('/api/v1/auth/email/login')
    .send({ email: buyer2Email, password: buyer2Password });
  const tok = login.body.token;
  await request(APP_URL)
    .post('/api/v1/cart/items')
    .set('Authorization', `Bearer ${tok}`)
    .send({ variantId, quantity: 1 });
  const place = await request(APP_URL)
    .post('/api/v1/orders')
    .set('Authorization', `Bearer ${tok}`)
    .set('Idempotency-Key', validKey('place2'))
    .send({ address: saAddress, paymentMethod: 'COD' });
  const oid2 = place.body.id;
  const sid2 = place.body.subOrders[0].id;
  const oii2 = place.body.subOrders[0].items[0].id;

  const res = await request(APP_URL)
    .post(`/api/v1/orders/${oid2}/suborders/${sid2}/returns`)
    .set('Authorization', `Bearer ${tok}`)
    .send({
      items: [{ orderItemId: oii2, quantity: 1 }],
      reason: 'DAMAGED',
    });
  expect(res.status).toBe(422);
  expect(res.body.message).toMatch(/DELIVERED/i);
});

it('should reject reason=OTHER without reasonNote', async () => {
  // Use a different sub-order? Easier: use the SAME buyer + create another order;
  // but the original sub-order's items are already covered by RMA in test 1.
  // For simplicity skip this case if no fresh sub-order is available.
  // We'll instead use the original buyer's other_buyerId path: a quick-and-dirty
  // approach is to create a second placement.
  const ts3 = Date.now();
  const idem = validKey(`other-${ts3}`);
  // re-stock cart
  await request(APP_URL)
    .post('/api/v1/cart/items')
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({ variantId, quantity: 1 });
  const place = await request(APP_URL)
    .post('/api/v1/orders')
    .set('Authorization', `Bearer ${buyerToken}`)
    .set('Idempotency-Key', idem)
    .send({ address: saAddress, paymentMethod: 'COD' });
  const oid3 = place.body.id;
  const sid3 = place.body.subOrders[0].id;
  const oii3 = place.body.subOrders[0].items[0].id;
  for (const target of ['CONFIRMED', 'PACKED', 'SHIPPED']) {
    await request(APP_URL)
      .patch(`/api/v1/vendor/suborders/${sid3}/status`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: target });
  }
  await request(APP_URL)
    .post(`/api/v1/orders/${oid3}/suborders/${sid3}/confirm-delivery`)
    .set('Authorization', `Bearer ${buyerToken}`);

  const res = await request(APP_URL)
    .post(`/api/v1/orders/${oid3}/suborders/${sid3}/returns`)
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({ items: [{ orderItemId: oii3, quantity: 1 }], reason: 'OTHER' });
  expect(res.status).toBe(422);
  expect(res.body.message).toMatch(/reasonNote/i);
});

it('should reject quantity > ordered', async () => {
  const ts4 = Date.now();
  const idem = validKey(`big-${ts4}`);
  await request(APP_URL)
    .post('/api/v1/cart/items')
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({ variantId, quantity: 1 });
  const place = await request(APP_URL)
    .post('/api/v1/orders')
    .set('Authorization', `Bearer ${buyerToken}`)
    .set('Idempotency-Key', idem)
    .send({ address: saAddress, paymentMethod: 'COD' });
  const oid4 = place.body.id;
  const sid4 = place.body.subOrders[0].id;
  const oii4 = place.body.subOrders[0].items[0].id;
  for (const target of ['CONFIRMED', 'PACKED', 'SHIPPED']) {
    await request(APP_URL)
      .patch(`/api/v1/vendor/suborders/${sid4}/status`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: target });
  }
  await request(APP_URL)
    .post(`/api/v1/orders/${oid4}/suborders/${sid4}/confirm-delivery`)
    .set('Authorization', `Bearer ${buyerToken}`);

  const res = await request(APP_URL)
    .post(`/api/v1/orders/${oid4}/suborders/${sid4}/returns`)
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({
      items: [{ orderItemId: oii4, quantity: 99 }],
      reason: 'DAMAGED',
    });
  expect(res.status).toBe(422);
  expect(res.body.message).toMatch(/quantity/i);
});

it('should return 404 when another buyer reads the RMA', async () => {
  const ts5 = Date.now();
  const otherEmail = `rma-other-${ts5}@example.com`;
  const otherPassword = 'Pass1234!';
  await request(APP_URL).post('/api/v1/auth/email/register').send({
    email: otherEmail,
    password: otherPassword,
    firstName: 'Other',
    lastName: 'Buyer',
  });
  const oLogin = await request(APP_URL)
    .post('/api/v1/auth/email/login')
    .send({ email: otherEmail, password: otherPassword });
  const otherTok = oLogin.body.token;
  const res = await request(APP_URL)
    .get(`/api/v1/returns/${returnId}`)
    .set('Authorization', `Bearer ${otherTok}`);
  expect(res.status).toBe(404);
});

it('should reject vendor PATCH from a different vendor (404)', async () => {
  // Sign up a second vendor. The first vendor's RMA is already CLOSED, so test
  // with a not-yet-closed RMA. Spin up another order through the buyer + vendor 1
  // and leave the RMA at REQUESTED.
  const ts6 = Date.now();
  const idem = validKey(`vendor2-${ts6}`);
  await request(APP_URL)
    .post('/api/v1/cart/items')
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({ variantId, quantity: 1 });
  const place = await request(APP_URL)
    .post('/api/v1/orders')
    .set('Authorization', `Bearer ${buyerToken}`)
    .set('Idempotency-Key', idem)
    .send({ address: saAddress, paymentMethod: 'COD' });
  const oid = place.body.id;
  const sid = place.body.subOrders[0].id;
  const oii = place.body.subOrders[0].items[0].id;
  for (const target of ['CONFIRMED', 'PACKED', 'SHIPPED']) {
    await request(APP_URL)
      .patch(`/api/v1/vendor/suborders/${sid}/status`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: target });
  }
  await request(APP_URL)
    .post(`/api/v1/orders/${oid}/suborders/${sid}/confirm-delivery`)
    .set('Authorization', `Bearer ${buyerToken}`);
  const open = await request(APP_URL)
    .post(`/api/v1/orders/${oid}/suborders/${sid}/returns`)
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({
      items: [{ orderItemId: oii, quantity: 1 }],
      reason: 'WRONG_ITEM',
    });
  const newReturnId = open.body.id;

  // Sign up vendor 2.
  const v2Email = `rma-vendor2-${ts6}@example.com`;
  await request(APP_URL).post('/api/v1/vendor/signup').send({
    email: v2Email,
    password: 'Pass1234!',
    firstName: 'Vendor',
    lastName: 'Two',
    shopName: `RMA Shop 2 ${ts6}`,
  });
  // Approve.
  const list = await request(APP_URL)
    .get('/api/v1/admin/vendors?status=PENDING')
    .set('Authorization', `Bearer ${adminToken}`);
  const newVendor = (list.body.data ?? []).find(
    (v: { email: string }) => v.email === v2Email,
  );
  if (newVendor) {
    await request(APP_URL)
      .patch(`/api/v1/admin/vendors/${newVendor.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
  }
  const v2Login = await request(APP_URL)
    .post('/api/v1/auth/email/login')
    .send({ email: v2Email, password: 'Pass1234!' });
  const v2Token = v2Login.body.token;

  // Vendor 2 tries to approve vendor 1's RMA.
  const res = await request(APP_URL)
    .patch(`/api/v1/vendor/returns/${newReturnId}`)
    .set('Authorization', `Bearer ${v2Token}`)
    .send({ status: 'APPROVED' });
  expect(res.status).toBe(404);
});
```

> Notes:
> - Some endpoint shapes (admin vendor list query, admin vendor approval URL, etc.) may differ slightly from your repo. If a fixture step fails, read the actual `src/admin-*/*.controller.ts` and adjust the test accordingly.
> - The "shipped-back without approval" and "duplicate RMA on same item" cases are exercised by the vendor-rejected-from-REQUESTED flow combined with the cumulative-quantity check above; if you want explicit dedicated tests, add them following the same shape.

- [ ] **Step 2: Run the spec**

Run: `npm run test:e2e -- --testPathPatterns="test/returns"`
Expected: original happy-path test still passes plus the 5 new edge-case tests.

- [ ] **Step 3: Commit**

```bash
git add test/returns/returns.e2e-spec.ts
git commit -m "test(returns): e2e edge cases (window, quantity, reason=OTHER, cross-tenant 404)"
```

---

## Task 16: Final verification + docs + PR

- [ ] **Step 1: Full test run**

Run: `npm run lint && npm test`
Expected: lint clean; ~110+ unit tests pass (94 prior + ~17 returns + state machine).

Run: `npm run build`
Expected: clean compile.

Run e2e — adjust the command for your local setup; if you can run against the Docker compose:
`npm run test:e2e:relational:docker -- --testPathPatterns="test/returns"`

If the orchestration is broken (CI is currently red on main per the prior PR's notes), at minimum confirm the in-process unit tests + build are clean. Note any remaining gap explicitly in the PR body.

- [ ] **Step 2: Write the docs file**

Create `docs/returns.md`:

```markdown
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

When the vendor flips to `RECEIVED` with `restock: true`, each `return_item.quantity` is added to its variant's `variant_stock.quantity` inside the same TypeORM transaction that updates the RMA status — atomic restock + status flip. `restock: false` skips the increment.

## Sub-order auto-flip

When all items of a sub-order have CLOSED returns covering the full ordered quantity, the sub-order's `fulfillment_status` flips to `RETURNED` (the existing terminal state). Otherwise it stays `DELIVERED`.

## Audit trail

The existing `order_event` table is reused. The `order_event_type_enum` was extended with seven new values:
`RETURN_REQUESTED`, `RETURN_APPROVED`, `RETURN_REJECTED`, `RETURN_SHIPPED_BACK`, `RETURN_RECEIVED`, `RETURN_REFUNDED`, `RETURN_CLOSED`. The sub-order timeline endpoint at `GET /v1/orders/:id/suborders/:sid/events` shows fulfillment + return events interleaved chronologically with no API changes.

## Refund semantics for COD

In phase 10a, `REFUNDED` is a logical state — backend records the timestamp and amount, no money moves. Vendor and buyer settle off-platform. Phase 9b will plug Stripe refunds into the same transition for CARD orders.

## Known follow-ups

- **CARD refunds** (phase 9b): plug `paymentsService.refundForReturn(...)` into the `REFUNDED` transition for orders where `paymentMethod = CARD`.
- **Auto-CLOSE**: scheduled job to flip `REFUNDED` → `CLOSED` after N days of inactivity.
- **Vendor recalls**: vendor-initiated returns; needs admin moderation if buyer disputes.
- **Partial refunds**: vendor sets `refundAmountMinor` per RMA when keep-and-discount arrangements are needed.
- **Carrier integration** for return shipping labels.
```

- [ ] **Step 3: Commit docs**

```bash
git add docs/returns.md
git commit -m "docs(returns): document the RMA flow"
```

- [ ] **Step 4: Push the branch**

```bash
git push -u origin phase-10a-returns
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --title "feat: phase 10a — buyer-initiated returns / RMA" --base main --body-file - <<'EOF'
## Summary

Phase 10a of the e-commerce backend roadmap: buyer-initiated, post-delivery returns with a vendor-driven state machine. Per-item granularity, optional photo evidence (up to 5 attachments via existing files module), off-platform return shipping with optional tracking number, restock-on-receive vendor decision, automatic sub-order flip to `RETURNED` when fully returned. Real money movement (Stripe refunds) is deferred to phase 9b — `REFUNDED` is a logical state that records the obligation.

## Endpoints (new)

- `POST /v1/orders/:orderId/suborders/:subOrderId/returns` (buyer)
- `GET /v1/returns` + `GET /v1/returns/:id` (buyer)
- `PATCH /v1/returns/:id/shipped-back` (buyer)
- `GET /v1/vendor/returns` + `GET /v1/vendor/returns/:id` (vendor)
- `PATCH /v1/vendor/returns/:id` (vendor; transition body varies by target status)
- `GET /v1/admin/returns` + `GET /v1/admin/returns/:id` (admin, read-only)

## Test plan

- [x] `npm run lint` clean
- [x] `npm test` — unit tests including state-machine + service spec
- [ ] `npm run test:e2e` — happy path + edge cases (window expired, non-delivered, quantity over-cap, reason=OTHER without note, cross-tenant 404, wrong-vendor 404)
- [x] `npm run build` clean (no DI cycle errors)
- [ ] Manual smoke: buyer creates RMA, vendor walks it through the lifecycle, sub-order ends up in `RETURNED`, restock incremented

## Out of scope

- Stripe refunds — phase 9b
- Auto-CLOSE after N days
- Vendor-initiated recalls
- Partial refund amounts
- Carrier integrations for return labels

## Known follow-ups

See `docs/returns.md` § Known follow-ups.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

Capture the PR URL and report it back.

---

## Self-Review (controller's checklist, ran before handoff)

**Spec coverage:**
- ✅ Three new tables — Task 1 migration, Task 5 entities
- ✅ State machine — Task 3 (with TDD)
- ✅ Buyer + vendor + admin endpoints — Tasks 10, 11, 12
- ✅ Eligibility (delivered + window) — Task 8 service spec
- ✅ Quantity + cumulative validation — Task 8 service spec
- ✅ Open-RMA constraint app-enforced — Task 8 (`sumNonRejectedQuantitiesByOrderItem`)
- ✅ Reason=OTHER + reasonNote — Task 8 service spec
- ✅ Up-to-5 attachments — Task 8 service spec
- ✅ Restock decision + atomic stock increment — Tasks 8, 9 (raw SQL inside the TypeORM transaction in the returns repo's `markReceived`)
- ✅ Sub-order auto-flip to RETURNED — Task 9
- ✅ Audit events — Tasks 1 (enum) + 6 (insert in every transition)
- ✅ E2E happy path — Task 14
- ✅ E2E edge cases — Task 15
- ✅ Docs + PR — Task 16

**Type consistency:**
- `ReturnStatus` and `ReturnReason` are referenced consistently across all tasks.
- `MarkReceivedInput.stockIncrements` is `Array<{ variantId; delta }>` in both the abstract repo (Task 4) and the relational impl (Task 6).
- `sumNonRejectedQuantitiesByOrderItem` and `sumClosedQuantitiesByOrderItem` share the same input shape and return type (Map<string, number>).

**Placeholder scan:**
- No "TBD" / "TODO" / "fill in" remain.
- The `void subOrderId` stubs in Task 8's service are explicitly fleshed out in Task 9, with both the test un-skip and the helper implementations replaced.
- The `@nestjs/common` and TypeORM imports needed in each task are inlined, not deferred.
