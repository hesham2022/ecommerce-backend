# Phase 9a — Payment Gateway & Card Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace COD-only checkout with a multi-gateway card-payment flow, shipping Stripe as the first concrete provider behind a swap-friendly interface so Tap/HyperPay can be added later without touching the orders module.

**Architecture:** Introduce a new `payments` module that owns a `PaymentProviderInterface` (createIntent / verifyWebhook / parseEvent) plus a `PaymentProviderRegistry`. A `StripeProvider` implements the interface using `@stripe/stripe-node`. Persistence follows the existing hexagonal pattern: domain → abstract repository → relational entity + mapper. Checkout branches on `paymentMethod`: `COD` keeps the current path; `CARD` creates a `Payment` row + Stripe PaymentIntent and returns a `clientSecret` to the buyer. Sub-orders for `CARD` orders are hidden from vendors until the Stripe webhook flips `paymentStatus` to `COLLECTED`. Webhook signature verification, event-level idempotency, and order cancellation on payment failure are required.

**Tech Stack:** NestJS 11, TypeORM 0.3, PostgreSQL, `@nestjs/config` with `registerAs`, `stripe` (Node SDK), Jest 30, supertest for e2e.

**Out of scope (future sub-phases):** refunds (9b), commission engine + vendor wallet (9c), payouts (9d), Tap/HyperPay adapters (deferred — interface is built so they slot in).

---

## File Structure

**New module under `src/payments/`:**

```
src/payments/
  domain/
    payment.ts                         # Domain class
    payment-event.ts                   # Domain class
    payment-enums.ts                   # PaymentStatus, PaymentProviderName
  dto/
    create-payment.dto.ts              # request body for create
    payment-response.dto.ts            # API shape returned to buyer
  infrastructure/
    persistence/
      payment.abstract.repository.ts
      payment-event.abstract.repository.ts
      relational/
        entities/
          payment.entity.ts
          payment-event.entity.ts
        mappers/
          payment.mapper.ts
          payment-event.mapper.ts
        repositories/
          payment.repository.ts
          payment-event.repository.ts
        relational-persistence.module.ts
  providers/
    payment-provider.interface.ts      # contract every gateway must satisfy
    payment-provider.registry.ts       # provider-name → impl lookup
    stripe.provider.ts                 # Stripe adapter
    stripe.provider.spec.ts
  payments.controller.ts               # GET /payments/:id
  payments.service.ts                  # orchestrator (provider + repo + order linkage)
  payments.service.spec.ts
  webhooks/
    stripe-webhook.controller.ts       # raw-body endpoint
    stripe-webhook.controller.spec.ts
    webhook-handler.service.ts         # event-type dispatch
    webhook-handler.service.spec.ts
  payments.module.ts
```

**Modifications to existing files:**

```
src/orders/domain/order-enums.ts             # add CARD to OrderPaymentMethod
src/orders/checkout.service.ts                # branch on paymentMethod for CARD
src/orders/checkout.controller.ts             # response shape adds optional clientSecret
src/orders/dto/place-order.dto.ts             # accepts CARD, optional providerName
src/orders/vendor-suborders.controller.ts     # gate visibility on paymentStatus
src/orders/orders.service.ts                  # mark sub-orders visible after payment
src/config/config.type.ts                     # add StripeConfig type
src/config/app-config.type.ts                 # (no change — separate config)
src/app.module.ts                              # register PaymentsModule + StripeConfig
src/main.ts                                    # raw-body parser for webhook route
.env.example                                   # STRIPE_* vars
```

**New migration:**

```
src/database/migrations/1777500000000-CreatePayments.ts
```

---

## Task 1: Migration — payments tables & extend payment-method enum

**Files:**
- Create: `src/database/migrations/1777500000000-CreatePayments.ts`
- Modify: `src/orders/domain/order-enums.ts`

- [ ] **Step 1: Add CARD to the OrderPaymentMethod enum**

Modify `src/orders/domain/order-enums.ts`:

```ts
export enum OrderPaymentMethod {
  COD = 'COD',
  CARD = 'CARD',
}
```

- [ ] **Step 2: Write the migration**

Create `src/database/migrations/1777500000000-CreatePayments.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePayments1777500000000 implements MigrationInterface {
  name = 'CreatePayments1777500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Extend the existing order_payment_method_enum so we don't have to
    //    drop and recreate the column on the order table.
    await queryRunner.query(
      `ALTER TYPE "order_payment_method_enum" ADD VALUE IF NOT EXISTS 'CARD'`,
    );

    // 2. payment_status_enum (separate from order_payment_status_enum so the
    //    payment table can model the gateway lifecycle independently).
    await queryRunner.query(
      `CREATE TYPE "payment_status_enum" AS ENUM (` +
        `'REQUIRES_ACTION','PROCESSING','SUCCEEDED','FAILED','CANCELED'` +
        `)`,
    );

    // 3. payment_provider_enum
    await queryRunner.query(
      `CREATE TYPE "payment_provider_enum" AS ENUM ('STRIPE','TAP','HYPERPAY')`,
    );

    // 4. payment table
    await queryRunner.query(
      `CREATE TABLE "payment" (` +
        `"id" uuid NOT NULL, ` +
        `"order_id" uuid NOT NULL, ` +
        `"provider" "payment_provider_enum" NOT NULL, ` +
        `"provider_intent_id" varchar(255) NOT NULL, ` +
        `"client_secret" varchar(512), ` +
        `"status" "payment_status_enum" NOT NULL DEFAULT 'REQUIRES_ACTION', ` +
        `"amount_minor" bigint NOT NULL, ` +
        `"currency_code" varchar(3) NOT NULL, ` +
        `"last_error" text, ` +
        `"metadata" jsonb NOT NULL DEFAULT '{}'::jsonb, ` +
        `"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_payment_id" PRIMARY KEY ("id")` +
        `)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_payment_provider_intent" ` +
        `ON "payment" ("provider", "provider_intent_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_payment_order" ON "payment" ("order_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment" ADD CONSTRAINT "FK_payment_order_id" ` +
        `FOREIGN KEY ("order_id") REFERENCES "order"("id") ` +
        `ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // 5. payment_event table — append-only audit of webhook deliveries
    await queryRunner.query(
      `CREATE TABLE "payment_event" (` +
        `"id" uuid NOT NULL, ` +
        `"payment_id" uuid NOT NULL, ` +
        `"provider" "payment_provider_enum" NOT NULL, ` +
        `"provider_event_id" varchar(255) NOT NULL, ` +
        `"event_type" varchar(128) NOT NULL, ` +
        `"payload" jsonb NOT NULL, ` +
        `"received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_payment_event_id" PRIMARY KEY ("id")` +
        `)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_payment_event_provider_evt" ` +
        `ON "payment_event" ("provider", "provider_event_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_payment_event_payment" ON "payment_event" ("payment_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_event" ADD CONSTRAINT "FK_payment_event_payment_id" ` +
        `FOREIGN KEY ("payment_id") REFERENCES "payment"("id") ` +
        `ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payment_event" DROP CONSTRAINT "FK_payment_event_payment_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_payment_event_payment"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_payment_event_provider_evt"`,
    );
    await queryRunner.query(`DROP TABLE "payment_event"`);
    await queryRunner.query(
      `ALTER TABLE "payment" DROP CONSTRAINT "FK_payment_order_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_payment_order"`);
    await queryRunner.query(`DROP INDEX "public"."uq_payment_provider_intent"`);
    await queryRunner.query(`DROP TABLE "payment"`);
    await queryRunner.query(`DROP TYPE "payment_provider_enum"`);
    await queryRunner.query(`DROP TYPE "payment_status_enum"`);
    // Note: Postgres cannot drop a single enum value, so the CARD value stays
    // in order_payment_method_enum on rollback. That is intentional and safe —
    // no orders exist with that value if the migration is rolled back cleanly.
  }
}
```

- [ ] **Step 3: Run the migration locally**

Run: `npm run migration:run`
Expected: `Migration CreatePayments1777500000000 has been executed successfully.`

- [ ] **Step 4: Verify the schema**

Run: `psql "$DATABASE_URL" -c "\d payment" -c "\d payment_event"`
Expected: both tables print with the columns defined above.

- [ ] **Step 5: Commit**

```bash
git add src/database/migrations/1777500000000-CreatePayments.ts \
        src/orders/domain/order-enums.ts
git commit -m "feat(payments): migration for payment + payment_event tables"
```

---

## Task 2: Domain types & enums

**Files:**
- Create: `src/payments/domain/payment.ts`
- Create: `src/payments/domain/payment-event.ts`
- Create: `src/payments/domain/payment-enums.ts`

- [ ] **Step 1: Write the enums file**

Create `src/payments/domain/payment-enums.ts`:

```ts
export enum PaymentProviderName {
  STRIPE = 'STRIPE',
  TAP = 'TAP',
  HYPERPAY = 'HYPERPAY',
}

export enum PaymentStatus {
  REQUIRES_ACTION = 'REQUIRES_ACTION',
  PROCESSING = 'PROCESSING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELED = 'CANCELED',
}
```

- [ ] **Step 2: Write the Payment domain class**

Create `src/payments/domain/payment.ts`:

```ts
import { PaymentProviderName, PaymentStatus } from './payment-enums';

export class Payment {
  id!: string;
  orderId!: string;
  provider!: PaymentProviderName;
  providerIntentId!: string;
  clientSecret!: string | null;
  status!: PaymentStatus;
  amountMinor!: string;
  currencyCode!: string;
  lastError!: string | null;
  metadata!: Record<string, unknown>;
  createdAt!: Date;
  updatedAt!: Date;
}
```

- [ ] **Step 3: Write the PaymentEvent domain class**

Create `src/payments/domain/payment-event.ts`:

```ts
import { PaymentProviderName } from './payment-enums';

export class PaymentEvent {
  id!: string;
  paymentId!: string;
  provider!: PaymentProviderName;
  providerEventId!: string;
  eventType!: string;
  payload!: Record<string, unknown>;
  receivedAt!: Date;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/payments/domain/
git commit -m "feat(payments): domain types and status enums"
```

---

## Task 3: Abstract repositories

**Files:**
- Create: `src/payments/infrastructure/persistence/payment.abstract.repository.ts`
- Create: `src/payments/infrastructure/persistence/payment-event.abstract.repository.ts`

- [ ] **Step 1: Write the Payment abstract repository**

Create `src/payments/infrastructure/persistence/payment.abstract.repository.ts`:

```ts
import { Payment } from '../../domain/payment';
import {
  PaymentProviderName,
  PaymentStatus,
} from '../../domain/payment-enums';

export interface CreatePaymentInput {
  id: string;
  orderId: string;
  provider: PaymentProviderName;
  providerIntentId: string;
  clientSecret: string | null;
  status: PaymentStatus;
  amountMinor: string;
  currencyCode: string;
  metadata: Record<string, unknown>;
}

export interface UpdatePaymentStatusInput {
  id: string;
  status: PaymentStatus;
  lastError?: string | null;
}

export abstract class PaymentAbstractRepository {
  abstract create(input: CreatePaymentInput): Promise<Payment>;
  abstract findById(id: string): Promise<Payment | null>;
  abstract findByOrderId(orderId: string): Promise<Payment | null>;
  abstract findByProviderIntent(
    provider: PaymentProviderName,
    providerIntentId: string,
  ): Promise<Payment | null>;
  abstract updateStatus(input: UpdatePaymentStatusInput): Promise<Payment>;
}
```

- [ ] **Step 2: Write the PaymentEvent abstract repository**

Create `src/payments/infrastructure/persistence/payment-event.abstract.repository.ts`:

```ts
import { PaymentEvent } from '../../domain/payment-event';
import { PaymentProviderName } from '../../domain/payment-enums';

export interface RecordPaymentEventInput {
  id: string;
  paymentId: string;
  provider: PaymentProviderName;
  providerEventId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export abstract class PaymentEventAbstractRepository {
  /**
   * Inserts an event row. Returns null if a row with the same
   * (provider, providerEventId) already exists — used for idempotency.
   */
  abstract recordIfNew(
    input: RecordPaymentEventInput,
  ): Promise<PaymentEvent | null>;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/payments/infrastructure/persistence/
git commit -m "feat(payments): abstract repository contracts"
```

---

## Task 4: Relational persistence layer

**Files:**
- Create: `src/payments/infrastructure/persistence/relational/entities/payment.entity.ts`
- Create: `src/payments/infrastructure/persistence/relational/entities/payment-event.entity.ts`
- Create: `src/payments/infrastructure/persistence/relational/mappers/payment.mapper.ts`
- Create: `src/payments/infrastructure/persistence/relational/mappers/payment-event.mapper.ts`
- Create: `src/payments/infrastructure/persistence/relational/repositories/payment.repository.ts`
- Create: `src/payments/infrastructure/persistence/relational/repositories/payment-event.repository.ts`
- Create: `src/payments/infrastructure/persistence/relational/relational-persistence.module.ts`

- [ ] **Step 1: PaymentEntity**

Create `src/payments/infrastructure/persistence/relational/entities/payment.entity.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { OrderEntity } from '../../../../../orders/infrastructure/persistence/relational/entities/order.entity';
import {
  PaymentProviderName,
  PaymentStatus,
} from '../../../../domain/payment-enums';

@Entity({ name: 'payment' })
@Unique('uq_payment_provider_intent', ['provider', 'providerIntentId'])
@Index('idx_payment_order', ['orderId'])
export class PaymentEntity extends EntityRelationalHelper {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @ManyToOne(() => OrderEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order!: OrderEntity;

  @Column({
    type: 'enum',
    enum: PaymentProviderName,
    enumName: 'payment_provider_enum',
  })
  provider!: PaymentProviderName;

  @Column({ name: 'provider_intent_id', length: 255 })
  providerIntentId!: string;

  @Column({ name: 'client_secret', length: 512, nullable: true })
  clientSecret!: string | null;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    enumName: 'payment_status_enum',
    default: PaymentStatus.REQUIRES_ACTION,
  })
  status!: PaymentStatus;

  @Column({ name: 'amount_minor', type: 'bigint' })
  amountMinor!: string;

  @Column({ name: 'currency_code', length: 3 })
  currencyCode!: string;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
```

- [ ] **Step 2: PaymentEventEntity**

Create `src/payments/infrastructure/persistence/relational/entities/payment-event.entity.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { PaymentProviderName } from '../../../../domain/payment-enums';
import { PaymentEntity } from './payment.entity';

@Entity({ name: 'payment_event' })
@Unique('uq_payment_event_provider_evt', ['provider', 'providerEventId'])
@Index('idx_payment_event_payment', ['paymentId'])
export class PaymentEventEntity extends EntityRelationalHelper {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'payment_id', type: 'uuid' })
  paymentId!: string;

  @ManyToOne(() => PaymentEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'payment_id' })
  payment!: PaymentEntity;

  @Column({
    type: 'enum',
    enum: PaymentProviderName,
    enumName: 'payment_provider_enum',
  })
  provider!: PaymentProviderName;

  @Column({ name: 'provider_event_id', length: 255 })
  providerEventId!: string;

  @Column({ name: 'event_type', length: 128 })
  eventType!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt!: Date;
}
```

- [ ] **Step 3: Mappers**

Create `src/payments/infrastructure/persistence/relational/mappers/payment.mapper.ts`:

```ts
import { Payment } from '../../../../domain/payment';
import { PaymentEntity } from '../entities/payment.entity';

export class PaymentMapper {
  static toDomain(entity: PaymentEntity): Payment {
    const dom = new Payment();
    dom.id = entity.id;
    dom.orderId = entity.orderId;
    dom.provider = entity.provider;
    dom.providerIntentId = entity.providerIntentId;
    dom.clientSecret = entity.clientSecret ?? null;
    dom.status = entity.status;
    dom.amountMinor = entity.amountMinor;
    dom.currencyCode = entity.currencyCode;
    dom.lastError = entity.lastError ?? null;
    dom.metadata = entity.metadata ?? {};
    dom.createdAt = entity.createdAt;
    dom.updatedAt = entity.updatedAt;
    return dom;
  }
}
```

Create `src/payments/infrastructure/persistence/relational/mappers/payment-event.mapper.ts`:

```ts
import { PaymentEvent } from '../../../../domain/payment-event';
import { PaymentEventEntity } from '../entities/payment-event.entity';

export class PaymentEventMapper {
  static toDomain(entity: PaymentEventEntity): PaymentEvent {
    const dom = new PaymentEvent();
    dom.id = entity.id;
    dom.paymentId = entity.paymentId;
    dom.provider = entity.provider;
    dom.providerEventId = entity.providerEventId;
    dom.eventType = entity.eventType;
    dom.payload = entity.payload ?? {};
    dom.receivedAt = entity.receivedAt;
    return dom;
  }
}
```

- [ ] **Step 4: Repositories**

Create `src/payments/infrastructure/persistence/relational/repositories/payment.repository.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from '../../../../domain/payment';
import {
  PaymentProviderName,
} from '../../../../domain/payment-enums';
import {
  CreatePaymentInput,
  PaymentAbstractRepository,
  UpdatePaymentStatusInput,
} from '../../payment.abstract.repository';
import { PaymentEntity } from '../entities/payment.entity';
import { PaymentMapper } from '../mappers/payment.mapper';

@Injectable()
export class PaymentRelationalRepository
  implements PaymentAbstractRepository
{
  constructor(
    @InjectRepository(PaymentEntity)
    private readonly repo: Repository<PaymentEntity>,
  ) {}

  async create(input: CreatePaymentInput): Promise<Payment> {
    const row = this.repo.create({
      id: input.id,
      orderId: input.orderId,
      provider: input.provider,
      providerIntentId: input.providerIntentId,
      clientSecret: input.clientSecret,
      status: input.status,
      amountMinor: input.amountMinor,
      currencyCode: input.currencyCode,
      metadata: input.metadata,
    });
    const saved = await this.repo.save(row);
    return PaymentMapper.toDomain(saved);
  }

  async findById(id: string): Promise<Payment | null> {
    const row = await this.repo.findOne({ where: { id } });
    return row ? PaymentMapper.toDomain(row) : null;
  }

  async findByOrderId(orderId: string): Promise<Payment | null> {
    const row = await this.repo.findOne({ where: { orderId } });
    return row ? PaymentMapper.toDomain(row) : null;
  }

  async findByProviderIntent(
    provider: PaymentProviderName,
    providerIntentId: string,
  ): Promise<Payment | null> {
    const row = await this.repo.findOne({
      where: { provider, providerIntentId },
    });
    return row ? PaymentMapper.toDomain(row) : null;
  }

  async updateStatus(input: UpdatePaymentStatusInput): Promise<Payment> {
    const row = await this.repo.findOne({ where: { id: input.id } });
    if (!row) throw new NotFoundException(`Payment ${input.id} not found`);
    row.status = input.status;
    if (input.lastError !== undefined) row.lastError = input.lastError;
    const saved = await this.repo.save(row);
    return PaymentMapper.toDomain(saved);
  }
}
```

Create `src/payments/infrastructure/persistence/relational/repositories/payment-event.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { PaymentEvent } from '../../../../domain/payment-event';
import {
  PaymentEventAbstractRepository,
  RecordPaymentEventInput,
} from '../../payment-event.abstract.repository';
import { PaymentEventEntity } from '../entities/payment-event.entity';
import { PaymentEventMapper } from '../mappers/payment-event.mapper';

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class PaymentEventRelationalRepository
  implements PaymentEventAbstractRepository
{
  constructor(
    @InjectRepository(PaymentEventEntity)
    private readonly repo: Repository<PaymentEventEntity>,
  ) {}

  async recordIfNew(
    input: RecordPaymentEventInput,
  ): Promise<PaymentEvent | null> {
    const row = this.repo.create({
      id: input.id,
      paymentId: input.paymentId,
      provider: input.provider,
      providerEventId: input.providerEventId,
      eventType: input.eventType,
      payload: input.payload,
    });
    try {
      const saved = await this.repo.save(row);
      return PaymentEventMapper.toDomain(saved);
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        // The DB-driver-specific code is on .driverError.code for pg.
        (err as unknown as { driverError?: { code?: string } }).driverError
          ?.code === PG_UNIQUE_VIOLATION
      ) {
        return null;
      }
      throw err;
    }
  }
}
```

- [ ] **Step 5: Persistence module**

Create `src/payments/infrastructure/persistence/relational/relational-persistence.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentAbstractRepository } from '../payment.abstract.repository';
import { PaymentEventAbstractRepository } from '../payment-event.abstract.repository';
import { PaymentEntity } from './entities/payment.entity';
import { PaymentEventEntity } from './entities/payment-event.entity';
import { PaymentRelationalRepository } from './repositories/payment.repository';
import { PaymentEventRelationalRepository } from './repositories/payment-event.repository';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentEntity, PaymentEventEntity])],
  providers: [
    {
      provide: PaymentAbstractRepository,
      useClass: PaymentRelationalRepository,
    },
    {
      provide: PaymentEventAbstractRepository,
      useClass: PaymentEventRelationalRepository,
    },
  ],
  exports: [PaymentAbstractRepository, PaymentEventAbstractRepository],
})
export class RelationalPaymentPersistenceModule {}
```

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck` (or `npx tsc --noEmit` if no script exists)
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/payments/infrastructure/
git commit -m "feat(payments): relational persistence layer"
```

---

## Task 5: Stripe configuration

**Files:**
- Create: `src/payments/config/stripe.config.ts`
- Create: `src/payments/config/stripe-config.type.ts`
- Modify: `src/config/config.type.ts`
- Modify: `.env.example`

- [ ] **Step 1: Type the config**

Create `src/payments/config/stripe-config.type.ts`:

```ts
export type StripeConfig = {
  secretKey: string;
  webhookSecret: string;
  publishableKey: string;
};
```

- [ ] **Step 2: Validated registerAs config**

Create `src/payments/config/stripe.config.ts`:

```ts
import { registerAs } from '@nestjs/config';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import validateConfig from '../../utils/validate-config';
import { StripeConfig } from './stripe-config.type';

class EnvironmentVariablesValidator {
  @IsString()
  @IsOptional()
  STRIPE_SECRET_KEY: string;

  @IsString()
  @IsOptional()
  STRIPE_WEBHOOK_SECRET: string;

  @IsString()
  @IsOptional()
  STRIPE_PUBLISHABLE_KEY: string;
}

export default registerAs<StripeConfig>('stripe', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);
  return {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? '',
  };
});
```

- [ ] **Step 3: Add to global config type**

Modify `src/config/config.type.ts` — add to the `AllConfigType` (open the file, find where existing config types are aggregated, and add):

```ts
import { StripeConfig } from '../payments/config/stripe-config.type';

export type AllConfigType = {
  // ... existing keys (app, database, auth, mail, file, redis, etc.)
  stripe: StripeConfig;
};
```

(If the file uses a single union/interface, append `stripe: StripeConfig;` to it.)

- [ ] **Step 4: Document env vars**

Append to `.env.example`:

```
# Stripe (required when CARD payments are enabled)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
```

- [ ] **Step 5: Commit**

```bash
git add src/payments/config/ src/config/config.type.ts .env.example
git commit -m "feat(payments): stripe config + env validation"
```

---

## Task 6: PaymentProvider interface

**Files:**
- Create: `src/payments/providers/payment-provider.interface.ts`

- [ ] **Step 1: Write the contract**

Create `src/payments/providers/payment-provider.interface.ts`:

```ts
import { PaymentProviderName, PaymentStatus } from '../domain/payment-enums';

export interface CreateIntentInput {
  orderId: string;
  amountMinor: string;
  currencyCode: string;
  metadata: Record<string, string>;
}

export interface CreateIntentResult {
  providerIntentId: string;
  clientSecret: string | null;
  status: PaymentStatus;
}

export interface ParsedWebhookEvent {
  providerEventId: string;
  eventType: string;
  providerIntentId: string;
  status: PaymentStatus;
  errorMessage: string | null;
  raw: Record<string, unknown>;
}

/**
 * Implemented once per gateway (Stripe today; Tap/HyperPay later).
 * The interface is intentionally narrow — only what checkout + webhooks
 * need today. Refunds + payouts will extend this in 9b/9d.
 */
export abstract class PaymentProviderInterface {
  abstract readonly name: PaymentProviderName;

  abstract createIntent(input: CreateIntentInput): Promise<CreateIntentResult>;

  /**
   * Verify the signature header against the raw request body. Throws if
   * the signature is invalid. Returns the parsed event on success.
   */
  abstract verifyAndParseWebhook(
    rawBody: Buffer,
    signatureHeader: string,
  ): ParsedWebhookEvent;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/payments/providers/payment-provider.interface.ts
git commit -m "feat(payments): provider interface contract"
```

---

## Task 7: Stripe provider implementation

**Files:**
- Create: `src/payments/providers/stripe.provider.ts`
- Test: `src/payments/providers/stripe.provider.spec.ts`

- [ ] **Step 1: Install the Stripe SDK**

Run: `npm install stripe`
Expected: `stripe` added to `dependencies` in `package.json`.

- [ ] **Step 2: Write the failing test**

Create `src/payments/providers/stripe.provider.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PaymentStatus } from '../domain/payment-enums';
import { StripeProvider } from './stripe.provider';

jest.mock('stripe');

describe('StripeProvider', () => {
  let provider: StripeProvider;
  let stripeMock: jest.Mocked<Stripe>;

  beforeEach(() => {
    const config = {
      get: (key: string) => {
        if (key === 'stripe') {
          return {
            secretKey: 'sk_test_x',
            webhookSecret: 'whsec_x',
            publishableKey: 'pk_test_x',
          };
        }
        return undefined;
      },
    } as unknown as ConfigService;

    stripeMock = {
      paymentIntents: {
        create: jest.fn(),
      },
      webhooks: {
        constructEvent: jest.fn(),
      },
    } as unknown as jest.Mocked<Stripe>;
    (Stripe as unknown as jest.Mock).mockImplementation(() => stripeMock);

    provider = new StripeProvider(config);
  });

  describe('createIntent', () => {
    it('creates a Stripe PaymentIntent and maps the response', async () => {
      (stripeMock.paymentIntents.create as jest.Mock).mockResolvedValue({
        id: 'pi_123',
        client_secret: 'pi_123_secret_x',
        status: 'requires_payment_method',
      });

      const result = await provider.createIntent({
        orderId: 'order-uuid',
        amountMinor: '12345',
        currencyCode: 'USD',
        metadata: { orderId: 'order-uuid' },
      });

      expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith({
        amount: 12345,
        currency: 'usd',
        metadata: { orderId: 'order-uuid' },
        automatic_payment_methods: { enabled: true },
      });
      expect(result).toEqual({
        providerIntentId: 'pi_123',
        clientSecret: 'pi_123_secret_x',
        status: PaymentStatus.REQUIRES_ACTION,
      });
    });
  });

  describe('verifyAndParseWebhook', () => {
    it('parses payment_intent.succeeded into SUCCEEDED status', () => {
      (stripeMock.webhooks.constructEvent as jest.Mock).mockReturnValue({
        id: 'evt_1',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_123',
            status: 'succeeded',
            last_payment_error: null,
          },
        },
      });

      const event = provider.verifyAndParseWebhook(
        Buffer.from('{}'),
        't=1,v1=sig',
      );

      expect(event.providerEventId).toBe('evt_1');
      expect(event.eventType).toBe('payment_intent.succeeded');
      expect(event.providerIntentId).toBe('pi_123');
      expect(event.status).toBe(PaymentStatus.SUCCEEDED);
      expect(event.errorMessage).toBeNull();
    });

    it('parses payment_intent.payment_failed into FAILED status', () => {
      (stripeMock.webhooks.constructEvent as jest.Mock).mockReturnValue({
        id: 'evt_2',
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_456',
            status: 'requires_payment_method',
            last_payment_error: { message: 'card declined' },
          },
        },
      });

      const event = provider.verifyAndParseWebhook(
        Buffer.from('{}'),
        't=1,v1=sig',
      );

      expect(event.status).toBe(PaymentStatus.FAILED);
      expect(event.errorMessage).toBe('card declined');
    });

    it('throws if Stripe rejects the signature', () => {
      (stripeMock.webhooks.constructEvent as jest.Mock).mockImplementation(
        () => {
          throw new Error('Invalid signature');
        },
      );

      expect(() =>
        provider.verifyAndParseWebhook(Buffer.from('{}'), 'bad-sig'),
      ).toThrow('Invalid signature');
    });
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `npm test -- src/payments/providers/stripe.provider.spec.ts`
Expected: FAIL — `StripeProvider` cannot be imported.

- [ ] **Step 4: Implement `StripeProvider`**

Create `src/payments/providers/stripe.provider.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import {
  PaymentProviderName,
  PaymentStatus,
} from '../domain/payment-enums';
import { StripeConfig } from '../config/stripe-config.type';
import {
  CreateIntentInput,
  CreateIntentResult,
  ParsedWebhookEvent,
  PaymentProviderInterface,
} from './payment-provider.interface';

const STATUS_MAP: Record<Stripe.PaymentIntent.Status, PaymentStatus> = {
  requires_payment_method: PaymentStatus.REQUIRES_ACTION,
  requires_confirmation: PaymentStatus.REQUIRES_ACTION,
  requires_action: PaymentStatus.REQUIRES_ACTION,
  processing: PaymentStatus.PROCESSING,
  requires_capture: PaymentStatus.PROCESSING,
  succeeded: PaymentStatus.SUCCEEDED,
  canceled: PaymentStatus.CANCELED,
};

@Injectable()
export class StripeProvider extends PaymentProviderInterface {
  readonly name = PaymentProviderName.STRIPE;
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(config: ConfigService) {
    super();
    const cfg = config.get<StripeConfig>('stripe');
    if (!cfg) throw new Error('Stripe config is missing');
    this.stripe = new Stripe(cfg.secretKey, { apiVersion: '2024-06-20' });
    this.webhookSecret = cfg.webhookSecret;
  }

  async createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    const intent = await this.stripe.paymentIntents.create({
      amount: Number(input.amountMinor),
      currency: input.currencyCode.toLowerCase(),
      metadata: input.metadata,
      automatic_payment_methods: { enabled: true },
    });
    return {
      providerIntentId: intent.id,
      clientSecret: intent.client_secret ?? null,
      status: this.mapStatus(intent.status),
    };
  }

  verifyAndParseWebhook(
    rawBody: Buffer,
    signatureHeader: string,
  ): ParsedWebhookEvent {
    const event = this.stripe.webhooks.constructEvent(
      rawBody,
      signatureHeader,
      this.webhookSecret,
    );

    let status: PaymentStatus;
    if (event.type === 'payment_intent.payment_failed') {
      status = PaymentStatus.FAILED;
    } else if (event.type === 'payment_intent.canceled') {
      status = PaymentStatus.CANCELED;
    } else {
      const intent = event.data.object as Stripe.PaymentIntent;
      status = this.mapStatus(intent.status);
    }

    const intent = event.data.object as Stripe.PaymentIntent;
    return {
      providerEventId: event.id,
      eventType: event.type,
      providerIntentId: intent.id,
      status,
      errorMessage: intent.last_payment_error?.message ?? null,
      raw: event as unknown as Record<string, unknown>,
    };
  }

  private mapStatus(s: Stripe.PaymentIntent.Status): PaymentStatus {
    return STATUS_MAP[s] ?? PaymentStatus.REQUIRES_ACTION;
  }
}
```

- [ ] **Step 5: Re-run the test, verify it passes**

Run: `npm test -- src/payments/providers/stripe.provider.spec.ts`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/payments/providers/stripe.provider.ts \
        src/payments/providers/stripe.provider.spec.ts
git commit -m "feat(payments): stripe provider adapter"
```

---

## Task 8: Provider registry

**Files:**
- Create: `src/payments/providers/payment-provider.registry.ts`

- [ ] **Step 1: Write the registry**

Create `src/payments/providers/payment-provider.registry.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PaymentProviderName } from '../domain/payment-enums';
import { PaymentProviderInterface } from './payment-provider.interface';
import { StripeProvider } from './stripe.provider';

@Injectable()
export class PaymentProviderRegistry {
  private readonly providers: Map<
    PaymentProviderName,
    PaymentProviderInterface
  >;

  constructor(stripe: StripeProvider) {
    this.providers = new Map<PaymentProviderName, PaymentProviderInterface>([
      [stripe.name, stripe],
    ]);
  }

  get(name: PaymentProviderName): PaymentProviderInterface {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new NotFoundException(
        `Payment provider ${name} is not configured`,
      );
    }
    return provider;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/payments/providers/payment-provider.registry.ts
git commit -m "feat(payments): provider registry"
```

---

## Task 9: PaymentsService

**Files:**
- Create: `src/payments/payments.service.ts`
- Test: `src/payments/payments.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/payments/payments.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { PaymentsService } from './payments.service';
import { PaymentAbstractRepository } from './infrastructure/persistence/payment.abstract.repository';
import { PaymentEventAbstractRepository } from './infrastructure/persistence/payment-event.abstract.repository';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';
import {
  PaymentProviderName,
  PaymentStatus,
} from './domain/payment-enums';
import { Payment } from './domain/payment';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let paymentRepo: jest.Mocked<PaymentAbstractRepository>;
  let registry: jest.Mocked<PaymentProviderRegistry>;
  const stripeProvider = {
    name: PaymentProviderName.STRIPE,
    createIntent: jest.fn(),
    verifyAndParseWebhook: jest.fn(),
  };

  beforeEach(async () => {
    paymentRepo = {
      create: jest.fn(),
      findById: jest.fn(),
      findByOrderId: jest.fn(),
      findByProviderIntent: jest.fn(),
      updateStatus: jest.fn(),
    } as unknown as jest.Mocked<PaymentAbstractRepository>;

    registry = {
      get: jest.fn().mockReturnValue(stripeProvider),
    } as unknown as jest.Mocked<PaymentProviderRegistry>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PaymentAbstractRepository, useValue: paymentRepo },
        {
          provide: PaymentEventAbstractRepository,
          useValue: { recordIfNew: jest.fn() },
        },
        { provide: PaymentProviderRegistry, useValue: registry },
      ],
    }).compile();
    service = moduleRef.get(PaymentsService);
  });

  it('createForOrder calls provider then persists payment', async () => {
    stripeProvider.createIntent.mockResolvedValue({
      providerIntentId: 'pi_xyz',
      clientSecret: 'pi_xyz_secret',
      status: PaymentStatus.REQUIRES_ACTION,
    });
    const stored = new Payment();
    stored.id = 'pay-uuid';
    stored.clientSecret = 'pi_xyz_secret';
    stored.providerIntentId = 'pi_xyz';
    stored.status = PaymentStatus.REQUIRES_ACTION;
    paymentRepo.create.mockResolvedValue(stored);

    const result = await service.createForOrder({
      orderId: 'order-uuid',
      provider: PaymentProviderName.STRIPE,
      amountMinor: '5000',
      currencyCode: 'USD',
    });

    expect(stripeProvider.createIntent).toHaveBeenCalledWith({
      orderId: 'order-uuid',
      amountMinor: '5000',
      currencyCode: 'USD',
      metadata: { orderId: 'order-uuid' },
    });
    expect(paymentRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-uuid',
        provider: PaymentProviderName.STRIPE,
        providerIntentId: 'pi_xyz',
        clientSecret: 'pi_xyz_secret',
        status: PaymentStatus.REQUIRES_ACTION,
      }),
    );
    expect(result.clientSecret).toBe('pi_xyz_secret');
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test -- src/payments/payments.service.spec.ts`
Expected: FAIL — `PaymentsService` not exported.

- [ ] **Step 3: Implement the service**

Create `src/payments/payments.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { uuidv7Generate } from '../utils/uuid';
import { Payment } from './domain/payment';
import {
  PaymentProviderName,
  PaymentStatus,
} from './domain/payment-enums';
import { PaymentAbstractRepository } from './infrastructure/persistence/payment.abstract.repository';
import { PaymentEventAbstractRepository } from './infrastructure/persistence/payment-event.abstract.repository';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';

export interface CreatePaymentForOrderInput {
  orderId: string;
  provider: PaymentProviderName;
  amountMinor: string;
  currencyCode: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly payments: PaymentAbstractRepository,
    private readonly events: PaymentEventAbstractRepository,
    private readonly registry: PaymentProviderRegistry,
  ) {}

  async createForOrder(input: CreatePaymentForOrderInput): Promise<Payment> {
    const provider = this.registry.get(input.provider);
    const intent = await provider.createIntent({
      orderId: input.orderId,
      amountMinor: input.amountMinor,
      currencyCode: input.currencyCode,
      metadata: { orderId: input.orderId },
    });

    return this.payments.create({
      id: uuidv7Generate(),
      orderId: input.orderId,
      provider: input.provider,
      providerIntentId: intent.providerIntentId,
      clientSecret: intent.clientSecret,
      status: intent.status,
      amountMinor: input.amountMinor,
      currencyCode: input.currencyCode,
      metadata: {},
    });
  }

  async findById(id: string): Promise<Payment> {
    const payment = await this.payments.findById(id);
    if (!payment) throw new NotFoundException(`Payment ${id} not found`);
    return payment;
  }

  async findByOrderId(orderId: string): Promise<Payment | null> {
    return this.payments.findByOrderId(orderId);
  }

  async markStatus(
    paymentId: string,
    status: PaymentStatus,
    errorMessage: string | null,
  ): Promise<Payment> {
    return this.payments.updateStatus({
      id: paymentId,
      status,
      lastError: errorMessage,
    });
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npm test -- src/payments/payments.service.spec.ts`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add src/payments/payments.service.ts src/payments/payments.service.spec.ts
git commit -m "feat(payments): payments service orchestration"
```

---

## Task 10: Modify checkout flow to support CARD

**Files:**
- Modify: `src/orders/dto/place-order.dto.ts`
- Modify: `src/orders/checkout.service.ts`
- Modify: `src/orders/checkout.controller.ts`
- Modify: `src/orders/orders.module.ts`

- [ ] **Step 1: Extend the DTO**

Modify `src/orders/dto/place-order.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { OrderPaymentMethod } from '../domain/order-enums';
import { PaymentProviderName } from '../../payments/domain/payment-enums';
import { AddressDto } from './address.dto'; // existing

export class PlaceOrderDto {
  @ApiProperty({ enum: OrderPaymentMethod, example: OrderPaymentMethod.COD })
  @IsEnum(OrderPaymentMethod)
  paymentMethod!: OrderPaymentMethod;

  @ApiPropertyOptional({
    enum: PaymentProviderName,
    description:
      'Required when paymentMethod is CARD. Selects the gateway adapter.',
  })
  @IsOptional()
  @IsEnum(PaymentProviderName)
  paymentProvider?: PaymentProviderName;

  @ApiProperty({ type: () => AddressDto })
  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;
}
```

(If existing fields differ, preserve them — only add `paymentProvider`.)

- [ ] **Step 2: Modify `placeOrder` to branch on method**

Modify `src/orders/checkout.service.ts`. Replace the existing `placeOrder` signature and body:

```ts
import { PaymentsService } from '../payments/payments.service';
import { PaymentProviderName } from '../payments/domain/payment-enums';
import { Payment } from '../payments/domain/payment';

// In CheckoutService constructor, ADD: private readonly payments: PaymentsService

export interface PlaceOrderResult {
  order: Order;
  payment: Payment | null; // populated when paymentMethod === CARD
}

async placeOrder(
  userId: number,
  address: AddressSnapshot,
  paymentMethod: OrderPaymentMethod,
  paymentProvider: PaymentProviderName | undefined,
): Promise<PlaceOrderResult> {
  if (
    paymentMethod === OrderPaymentMethod.CARD &&
    paymentProvider === undefined
  ) {
    throw new UnprocessableEntityException(
      'paymentProvider is required when paymentMethod is CARD',
    );
  }

  // ... existing buildBreakdown + orderRow + subOrderRows + itemRows code
  // remains identical up to and including the persistence call. Capture the
  // returned order:
  // const order = await this.orders.createWithSubOrdersAndItems(...);

  let payment: Payment | null = null;
  if (paymentMethod === OrderPaymentMethod.CARD) {
    payment = await this.payments.createForOrder({
      orderId: order.id,
      provider: paymentProvider!,
      amountMinor: order.totalMinor,
      currencyCode: order.currencyCode,
    });
  }

  return { order, payment };
}
```

> Note: keep the rest of `placeOrder` (breakdown loading, sub-order/item row building, `await this.orders.createWithSubOrdersAndItems(...)`, cart clearing, etc.) verbatim. The only changes are: (a) the new signature param, (b) the early validation, (c) the conditional `paymentsService.createForOrder` call before returning.

- [ ] **Step 3: Update the controller response**

Modify `src/orders/checkout.controller.ts`. Add a new endpoint OR extend the existing place-order endpoint to return the payment intent's `clientSecret` when present:

```ts
import { PlaceOrderDto } from './dto/place-order.dto';

export interface PlaceOrderResponse {
  order: Order;
  payment: {
    id: string;
    provider: string;
    clientSecret: string | null;
    status: string;
  } | null;
}

@Post('place-order')
@HttpCode(HttpStatus.CREATED)
@ApiCreatedResponse({
  description:
    'Creates the order. For CARD orders, also creates a payment intent ' +
    'and returns clientSecret for SDK confirmation on the client.',
})
async placeOrder(
  @Req() req: Request,
  @Body() dto: PlaceOrderDto,
): Promise<PlaceOrderResponse> {
  const userId = (req.user as { id: number }).id;
  const result = await this.checkout.placeOrder(
    userId,
    {
      fullName: dto.address.fullName,
      phone: dto.address.phone,
      country: dto.address.country,
      region: dto.address.region ?? null,
      city: dto.address.city,
      postalCode: dto.address.postalCode ?? null,
      street: dto.address.street,
      notes: dto.address.notes ?? null,
    },
    dto.paymentMethod,
    dto.paymentProvider,
  );

  return {
    order: result.order,
    payment: result.payment
      ? {
          id: result.payment.id,
          provider: result.payment.provider,
          clientSecret: result.payment.clientSecret,
          status: result.payment.status,
        }
      : null,
  };
}
```

> If a `place-order` route already exists, modify it; do not create a duplicate.

- [ ] **Step 4: Wire PaymentsModule into OrdersModule**

Modify `src/orders/orders.module.ts`:

```ts
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    // ... existing imports
    PaymentsModule,
  ],
  // ...
})
export class OrdersModule {}
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/orders/dto/place-order.dto.ts \
        src/orders/checkout.service.ts \
        src/orders/checkout.controller.ts \
        src/orders/orders.module.ts
git commit -m "feat(orders): branch checkout on CARD payment method"
```

---

## Task 11: Vendor sub-order visibility gate

**Files:**
- Modify: `src/orders/infrastructure/persistence/order.abstract.repository.ts`
- Modify: `src/orders/infrastructure/persistence/relational/repositories/order.repository.ts`
- Modify: `src/orders/vendor-suborders.controller.ts` (or wherever vendor lists sub-orders)

- [ ] **Step 1: Document the rule in code**

Add a comment + helper to `src/orders/sub-order-state-machine.ts` (top of file):

```ts
import { OrderPaymentMethod, OrderPaymentStatus } from './domain/order-enums';

/**
 * Vendors must not see sub-orders for CARD orders that have not been paid.
 * COD orders are always visible (cash collected at delivery).
 */
export function isSubOrderVendorVisible(opts: {
  paymentMethod: OrderPaymentMethod;
  paymentStatus: OrderPaymentStatus;
}): boolean {
  if (opts.paymentMethod === OrderPaymentMethod.COD) return true;
  return opts.paymentStatus === OrderPaymentStatus.COLLECTED;
}
```

- [ ] **Step 2: Filter vendor list query**

Modify the vendor sub-orders list method in the order repository (find the existing `listForVendor` or equivalent and add the WHERE clause). Example update to the QueryBuilder:

```ts
// Inside listForVendor(vendorId: string, ...)
qb.innerJoin('sub_order.order', 'order')
  .andWhere(
    `(order.payment_method = :cod OR order.payment_status = :collected)`,
    {
      cod: OrderPaymentMethod.COD,
      collected: OrderPaymentStatus.COLLECTED,
    },
  );
```

(If listing happens in a service rather than a repo, apply the filter there. The exact location is `vendor-suborders.controller.ts` → service method.)

- [ ] **Step 3: Add a unit test for the helper**

Append to `src/orders/sub-order-state-machine.spec.ts`:

```ts
import {
  isSubOrderVendorVisible,
} from './sub-order-state-machine';
import {
  OrderPaymentMethod,
  OrderPaymentStatus,
} from './domain/order-enums';

describe('isSubOrderVendorVisible', () => {
  it('hides unpaid CARD orders from vendors', () => {
    expect(
      isSubOrderVendorVisible({
        paymentMethod: OrderPaymentMethod.CARD,
        paymentStatus: OrderPaymentStatus.PENDING,
      }),
    ).toBe(false);
  });

  it('shows paid CARD orders to vendors', () => {
    expect(
      isSubOrderVendorVisible({
        paymentMethod: OrderPaymentMethod.CARD,
        paymentStatus: OrderPaymentStatus.COLLECTED,
      }),
    ).toBe(true);
  });

  it('always shows COD orders to vendors', () => {
    expect(
      isSubOrderVendorVisible({
        paymentMethod: OrderPaymentMethod.COD,
        paymentStatus: OrderPaymentStatus.PENDING,
      }),
    ).toBe(true);
  });
});
```

- [ ] **Step 4: Run the unit test, verify pass**

Run: `npm test -- src/orders/sub-order-state-machine.spec.ts`
Expected: existing tests + 3 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/orders/sub-order-state-machine.ts \
        src/orders/sub-order-state-machine.spec.ts \
        src/orders/infrastructure/persistence/relational/repositories/order.repository.ts
git commit -m "feat(orders): hide unpaid CARD sub-orders from vendors"
```

---

## Task 12: Webhook handler service

**Files:**
- Create: `src/payments/webhooks/webhook-handler.service.ts`
- Test: `src/payments/webhooks/webhook-handler.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/payments/webhooks/webhook-handler.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { WebhookHandlerService } from './webhook-handler.service';
import { PaymentAbstractRepository } from '../infrastructure/persistence/payment.abstract.repository';
import { PaymentEventAbstractRepository } from '../infrastructure/persistence/payment-event.abstract.repository';
import {
  PaymentProviderName,
  PaymentStatus,
} from '../domain/payment-enums';
import { OrdersService } from '../../orders/orders.service';
import { Payment } from '../domain/payment';

describe('WebhookHandlerService', () => {
  let service: WebhookHandlerService;
  let payments: jest.Mocked<PaymentAbstractRepository>;
  let events: jest.Mocked<PaymentEventAbstractRepository>;
  let orders: jest.Mocked<OrdersService>;

  const dummyPayment = (status = PaymentStatus.REQUIRES_ACTION): Payment => {
    const p = new Payment();
    p.id = 'pay-1';
    p.orderId = 'ord-1';
    p.provider = PaymentProviderName.STRIPE;
    p.providerIntentId = 'pi_1';
    p.status = status;
    return p;
  };

  beforeEach(async () => {
    payments = {
      findByProviderIntent: jest.fn(),
      updateStatus: jest.fn(),
    } as unknown as jest.Mocked<PaymentAbstractRepository>;
    events = {
      recordIfNew: jest.fn(),
    } as unknown as jest.Mocked<PaymentEventAbstractRepository>;
    orders = {
      markPaid: jest.fn(),
      cancelForFailedPayment: jest.fn(),
    } as unknown as jest.Mocked<OrdersService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        WebhookHandlerService,
        { provide: PaymentAbstractRepository, useValue: payments },
        { provide: PaymentEventAbstractRepository, useValue: events },
        { provide: OrdersService, useValue: orders },
      ],
    }).compile();
    service = moduleRef.get(WebhookHandlerService);
  });

  it('marks payment SUCCEEDED and the order paid', async () => {
    payments.findByProviderIntent.mockResolvedValue(dummyPayment());
    events.recordIfNew.mockResolvedValue({} as never);
    payments.updateStatus.mockResolvedValue(
      dummyPayment(PaymentStatus.SUCCEEDED),
    );

    await service.handle({
      providerEventId: 'evt_1',
      eventType: 'payment_intent.succeeded',
      providerIntentId: 'pi_1',
      status: PaymentStatus.SUCCEEDED,
      errorMessage: null,
      raw: {},
    }, PaymentProviderName.STRIPE);

    expect(payments.updateStatus).toHaveBeenCalledWith({
      id: 'pay-1',
      status: PaymentStatus.SUCCEEDED,
      lastError: null,
    });
    expect(orders.markPaid).toHaveBeenCalledWith('ord-1');
    expect(orders.cancelForFailedPayment).not.toHaveBeenCalled();
  });

  it('marks payment FAILED and cancels the order', async () => {
    payments.findByProviderIntent.mockResolvedValue(dummyPayment());
    events.recordIfNew.mockResolvedValue({} as never);
    payments.updateStatus.mockResolvedValue(
      dummyPayment(PaymentStatus.FAILED),
    );

    await service.handle({
      providerEventId: 'evt_2',
      eventType: 'payment_intent.payment_failed',
      providerIntentId: 'pi_1',
      status: PaymentStatus.FAILED,
      errorMessage: 'card declined',
      raw: {},
    }, PaymentProviderName.STRIPE);

    expect(orders.cancelForFailedPayment).toHaveBeenCalledWith(
      'ord-1',
      'card declined',
    );
    expect(orders.markPaid).not.toHaveBeenCalled();
  });

  it('skips processing when the same event is delivered twice', async () => {
    events.recordIfNew.mockResolvedValue(null); // duplicate

    await service.handle({
      providerEventId: 'evt_1',
      eventType: 'payment_intent.succeeded',
      providerIntentId: 'pi_1',
      status: PaymentStatus.SUCCEEDED,
      errorMessage: null,
      raw: {},
    }, PaymentProviderName.STRIPE);

    expect(payments.updateStatus).not.toHaveBeenCalled();
    expect(orders.markPaid).not.toHaveBeenCalled();
  });

  it('throws when the payment intent is unknown', async () => {
    payments.findByProviderIntent.mockResolvedValue(null);

    await expect(
      service.handle({
        providerEventId: 'evt_1',
        eventType: 'payment_intent.succeeded',
        providerIntentId: 'pi_unknown',
        status: PaymentStatus.SUCCEEDED,
        errorMessage: null,
        raw: {},
      }, PaymentProviderName.STRIPE),
    ).rejects.toThrow(/unknown/i);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test -- src/payments/webhooks/webhook-handler.service.spec.ts`
Expected: FAIL — `WebhookHandlerService` not found.

- [ ] **Step 3: Implement the service**

Create `src/payments/webhooks/webhook-handler.service.ts`:

```ts
import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { uuidv7Generate } from '../../utils/uuid';
import { OrdersService } from '../../orders/orders.service';
import {
  PaymentProviderName,
  PaymentStatus,
} from '../domain/payment-enums';
import { PaymentAbstractRepository } from '../infrastructure/persistence/payment.abstract.repository';
import { PaymentEventAbstractRepository } from '../infrastructure/persistence/payment-event.abstract.repository';
import { ParsedWebhookEvent } from '../providers/payment-provider.interface';

@Injectable()
export class WebhookHandlerService {
  private readonly logger = new Logger(WebhookHandlerService.name);

  constructor(
    private readonly payments: PaymentAbstractRepository,
    private readonly events: PaymentEventAbstractRepository,
    private readonly orders: OrdersService,
  ) {}

  async handle(
    event: ParsedWebhookEvent,
    provider: PaymentProviderName,
  ): Promise<void> {
    const payment = await this.payments.findByProviderIntent(
      provider,
      event.providerIntentId,
    );
    if (!payment) {
      throw new NotFoundException(
        `Webhook references unknown payment intent ${event.providerIntentId}`,
      );
    }

    // Idempotency: try to insert the event row first. If a duplicate exists,
    // bail out — we've already processed this event.
    const recorded = await this.events.recordIfNew({
      id: uuidv7Generate(),
      paymentId: payment.id,
      provider,
      providerEventId: event.providerEventId,
      eventType: event.eventType,
      payload: event.raw,
    });
    if (!recorded) {
      this.logger.log(
        `Skipping duplicate webhook ${provider}:${event.providerEventId}`,
      );
      return;
    }

    await this.payments.updateStatus({
      id: payment.id,
      status: event.status,
      lastError: event.errorMessage,
    });

    if (event.status === PaymentStatus.SUCCEEDED) {
      await this.orders.markPaid(payment.orderId);
    } else if (
      event.status === PaymentStatus.FAILED ||
      event.status === PaymentStatus.CANCELED
    ) {
      await this.orders.cancelForFailedPayment(
        payment.orderId,
        event.errorMessage ?? 'payment failed',
      );
    }
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npm test -- src/payments/webhooks/webhook-handler.service.spec.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/payments/webhooks/webhook-handler.service.ts \
        src/payments/webhooks/webhook-handler.service.spec.ts
git commit -m "feat(payments): webhook event handler with idempotency"
```

---

## Task 13: OrdersService — markPaid + cancelForFailedPayment

**Files:**
- Modify: `src/orders/orders.service.ts`
- Modify: `src/orders/infrastructure/persistence/order.abstract.repository.ts`
- Modify: `src/orders/infrastructure/persistence/relational/repositories/order.repository.ts`
- Test: `src/orders/orders.service.spec.ts` (create or extend)

- [ ] **Step 1: Add abstract methods**

Add to `src/orders/infrastructure/persistence/order.abstract.repository.ts`:

```ts
abstract markPaid(orderId: string): Promise<void>;
abstract cancelForFailedPayment(
  orderId: string,
  reason: string,
): Promise<void>;
```

- [ ] **Step 2: Implement in the relational repo**

In `src/orders/infrastructure/persistence/relational/repositories/order.repository.ts`:

```ts
async markPaid(orderId: string): Promise<void> {
  await this.orderRepo.update(
    { id: orderId },
    { paymentStatus: OrderPaymentStatus.COLLECTED },
  );
}

async cancelForFailedPayment(
  orderId: string,
  reason: string,
): Promise<void> {
  await this.dataSource.transaction(async (mgr) => {
    await mgr.update(
      OrderEntity,
      { id: orderId },
      { paymentStatus: OrderPaymentStatus.FAILED },
    );
    await mgr.update(
      SubOrderEntity,
      { orderId, fulfillmentStatus: SubOrderFulfillmentStatus.AWAITING_CONFIRMATION },
      { fulfillmentStatus: SubOrderFulfillmentStatus.CANCELLED },
    );
    // Audit event
    await mgr.insert(OrderEventEntity, {
      id: uuidv7Generate(),
      orderId,
      type: OrderEventType.STATUS_CHANGED,
      payload: { reason: `payment_failed: ${reason}` },
    });
  });
}
```

(Adjust imports for `OrderEventEntity`, `SubOrderEntity`, `OrderEventType`, `SubOrderFulfillmentStatus`, `uuidv7Generate`. Inject `DataSource` if not already.)

- [ ] **Step 3: Expose via OrdersService**

Add to `src/orders/orders.service.ts`:

```ts
async markPaid(orderId: string): Promise<void> {
  await this.orders.markPaid(orderId);
}

async cancelForFailedPayment(
  orderId: string,
  reason: string,
): Promise<void> {
  await this.orders.cancelForFailedPayment(orderId, reason);
}
```

- [ ] **Step 4: Add a unit test**

Create or extend `src/orders/orders.service.spec.ts`:

```ts
it('markPaid delegates to repo', async () => {
  await service.markPaid('order-1');
  expect(repo.markPaid).toHaveBeenCalledWith('order-1');
});

it('cancelForFailedPayment delegates to repo', async () => {
  await service.cancelForFailedPayment('order-1', 'declined');
  expect(repo.cancelForFailedPayment).toHaveBeenCalledWith('order-1', 'declined');
});
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npm test -- src/orders/orders.service.spec.ts`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/orders/orders.service.ts \
        src/orders/orders.service.spec.ts \
        src/orders/infrastructure/persistence/
git commit -m "feat(orders): markPaid + cancelForFailedPayment hooks"
```

---

## Task 14: Stripe webhook controller (raw body + signature)

**Files:**
- Modify: `src/main.ts`
- Create: `src/payments/webhooks/stripe-webhook.controller.ts`

- [ ] **Step 1: Configure raw body for the webhook route**

Modify `src/main.ts`. After `app = await NestFactory.create<NestExpressApplication>(...)` add:

```ts
import * as bodyParser from 'body-parser';

app.use(
  '/api/v1/payments/webhooks/stripe',
  bodyParser.raw({ type: 'application/json' }),
);
```

> Place this **before** any global JSON body parser configuration. NestFactory wires JSON parsing by default, so this override must run first for the webhook path.

- [ ] **Step 2: Write the controller**

Create `src/payments/webhooks/stripe-webhook.controller.ts`:

```ts
import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PaymentProviderName } from '../domain/payment-enums';
import { PaymentProviderRegistry } from '../providers/payment-provider.registry';
import { WebhookHandlerService } from './webhook-handler.service';

@ApiTags('Webhooks · Stripe')
@Controller({ path: 'payments/webhooks/stripe', version: '1' })
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly registry: PaymentProviderRegistry,
    private readonly handler: WebhookHandlerService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async receive(
    @Req() req: Request,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<void> {
    if (!signature) throw new BadRequestException('Missing stripe-signature');
    const provider = this.registry.get(PaymentProviderName.STRIPE);

    let event;
    try {
      event = provider.verifyAndParseWebhook(
        req.body as Buffer,
        signature,
      );
    } catch (err) {
      this.logger.warn(`Stripe signature verification failed: ${err}`);
      throw new BadRequestException('Invalid signature');
    }

    await this.handler.handle(event, PaymentProviderName.STRIPE);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/main.ts src/payments/webhooks/stripe-webhook.controller.ts
git commit -m "feat(payments): stripe webhook receiver with signature check"
```

---

## Task 15: Buyer-facing payment status endpoint

**Files:**
- Create: `src/payments/payments.controller.ts`
- Create: `src/payments/dto/payment-response.dto.ts`

- [ ] **Step 1: Response DTO**

Create `src/payments/dto/payment-response.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import {
  PaymentProviderName,
  PaymentStatus,
} from '../domain/payment-enums';
import { Payment } from '../domain/payment';

export class PaymentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty({ enum: PaymentProviderName }) provider!: PaymentProviderName;
  @ApiProperty({ enum: PaymentStatus }) status!: PaymentStatus;
  @ApiProperty() amountMinor!: string;
  @ApiProperty() currencyCode!: string;
  @ApiProperty({ required: false, nullable: true })
  lastError!: string | null;

  static from(p: Payment): PaymentResponseDto {
    const dto = new PaymentResponseDto();
    dto.id = p.id;
    dto.orderId = p.orderId;
    dto.provider = p.provider;
    dto.status = p.status;
    dto.amountMinor = p.amountMinor;
    dto.currencyCode = p.currencyCode;
    dto.lastError = p.lastError;
    return dto;
  }
}
```

- [ ] **Step 2: Controller**

Create `src/payments/payments.controller.ts`:

```ts
import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { OrdersService } from '../orders/orders.service';
import { PaymentResponseDto } from './dto/payment-response.dto';
import { PaymentsService } from './payments.service';

@ApiTags('Buyer · Payments')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard('jwt'))
@Controller({ path: 'payments', version: '1' })
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly orders: OrdersService,
  ) {}

  @Get(':id')
  @ApiOkResponse({ type: PaymentResponseDto })
  async findById(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<PaymentResponseDto> {
    const userId = (req.user as { id: number }).id;
    const payment = await this.payments.findById(id);
    const order = await this.orders.findOneForBuyer(payment.orderId, userId);
    if (!order) throw new ForbiddenException();
    return PaymentResponseDto.from(payment);
  }
}
```

> If `OrdersService.findOneForBuyer` does not exist, use whatever the existing buyer-scoped order lookup is named — the goal is to ensure the requester owns the order before returning the payment.

- [ ] **Step 3: Commit**

```bash
git add src/payments/payments.controller.ts src/payments/dto/payment-response.dto.ts
git commit -m "feat(payments): buyer payment status endpoint"
```

---

## Task 16: Wire PaymentsModule

**Files:**
- Create: `src/payments/payments.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Module**

Create `src/payments/payments.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OrdersModule } from '../orders/orders.module';
import stripeConfig from './config/stripe.config';
import { RelationalPaymentPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';
import { StripeProvider } from './providers/stripe.provider';
import { StripeWebhookController } from './webhooks/stripe-webhook.controller';
import { WebhookHandlerService } from './webhooks/webhook-handler.service';

@Module({
  imports: [
    ConfigModule.forFeature(stripeConfig),
    RelationalPaymentPersistenceModule,
    // OrdersModule is imported here (and OrdersModule imports PaymentsModule
    // in Task 10) → break the cycle with forwardRef. See Step 2.
  ],
  controllers: [PaymentsController, StripeWebhookController],
  providers: [
    PaymentsService,
    StripeProvider,
    PaymentProviderRegistry,
    WebhookHandlerService,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
```

- [ ] **Step 2: Resolve the circular dependency with forwardRef**

In **both** `src/payments/payments.module.ts` and `src/orders/orders.module.ts`, replace the direct cross-import with `forwardRef`:

```ts
// payments.module.ts
import { forwardRef, Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [
    ConfigModule.forFeature(stripeConfig),
    RelationalPaymentPersistenceModule,
    forwardRef(() => OrdersModule),
  ],
  // ...
})

// orders.module.ts
import { forwardRef, Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    // ... other imports
    forwardRef(() => PaymentsModule),
  ],
  // ...
})
```

In services that inject the other side (e.g. `WebhookHandlerService` injecting `OrdersService`, `CheckoutService` injecting `PaymentsService`), wrap the constructor parameters with `@Inject(forwardRef(() => OtherService))`.

- [ ] **Step 3: Register PaymentsModule in AppModule**

Modify `src/app.module.ts`. Add to imports:

```ts
import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [
    // ... existing modules
    PaymentsModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 4: Run typecheck + boot**

Run: `npm run typecheck && npm run start:dev`
Expected: server boots, no DI cycle errors. Stop the server with Ctrl-C once startup is confirmed.

- [ ] **Step 5: Commit**

```bash
git add src/payments/payments.module.ts src/app.module.ts \
        src/orders/orders.module.ts
git commit -m "feat(payments): wire PaymentsModule into the app"
```

---

## Task 17: E2E test — happy path (CARD checkout → webhook → paid)

**Files:**
- Create: `test/payments/payments.e2e-spec.ts`

- [ ] **Step 1: Look at an existing e2e to mirror its bootstrap**

Read `test/orders/` (or `test/cart/`) for the typical setup pattern (Test.createTestingModule, login fixture, etc.). The new spec must use the same bootstrap.

- [ ] **Step 2: Write the e2e test**

Create `test/payments/payments.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import * as bodyParser from 'body-parser';
import { AppModule } from '../../src/app.module';
import { PaymentProviderRegistry } from '../../src/payments/providers/payment-provider.registry';
import {
  PaymentProviderName,
  PaymentStatus,
} from '../../src/payments/domain/payment-enums';

describe('Payments e2e — CARD happy path', () => {
  let app: INestApplication;
  let buyerToken: string;
  let providerStub: {
    name: PaymentProviderName;
    createIntent: jest.Mock;
    verifyAndParseWebhook: jest.Mock;
  };

  beforeAll(async () => {
    providerStub = {
      name: PaymentProviderName.STRIPE,
      createIntent: jest.fn().mockResolvedValue({
        providerIntentId: 'pi_e2e_1',
        clientSecret: 'pi_e2e_1_secret',
        status: PaymentStatus.REQUIRES_ACTION,
      }),
      verifyAndParseWebhook: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PaymentProviderRegistry)
      .useValue({ get: () => providerStub })
      .compile();

    app = moduleRef.createNestApplication();
    app.use(
      '/api/v1/payments/webhooks/stripe',
      bodyParser.raw({ type: 'application/json' }),
    );
    await app.init();

    // Use whatever helper your suite already has to create + login a buyer
    // and seed a cart with at least one item from a published product.
    buyerToken = await loginAndSeedCart(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('places a CARD order, returns clientSecret, then webhook flips to paid', async () => {
    // 1. POST place-order with CARD method
    const placeRes = await request(app.getHttpServer())
      .post('/api/v1/checkout/place-order')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        paymentMethod: 'CARD',
        paymentProvider: 'STRIPE',
        address: validAddress(),
      })
      .expect(201);

    expect(placeRes.body.payment).toBeTruthy();
    expect(placeRes.body.payment.clientSecret).toBe('pi_e2e_1_secret');
    expect(placeRes.body.payment.status).toBe('REQUIRES_ACTION');
    const orderId = placeRes.body.order.id;
    const paymentId = placeRes.body.payment.id;

    // 2. Buyer hits GET /payments/:id while still REQUIRES_ACTION
    await request(app.getHttpServer())
      .get(`/api/v1/payments/${paymentId}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200)
      .expect((r) => expect(r.body.status).toBe('REQUIRES_ACTION'));

    // 3. Stub the webhook parse so it returns SUCCEEDED for pi_e2e_1
    providerStub.verifyAndParseWebhook.mockReturnValue({
      providerEventId: 'evt_e2e_1',
      eventType: 'payment_intent.succeeded',
      providerIntentId: 'pi_e2e_1',
      status: PaymentStatus.SUCCEEDED,
      errorMessage: null,
      raw: {},
    });

    // 4. POST the webhook
    await request(app.getHttpServer())
      .post('/api/v1/payments/webhooks/stripe')
      .set('stripe-signature', 't=1,v1=anything')
      .set('content-type', 'application/json')
      .send(Buffer.from('{}'))
      .expect(204);

    // 5. Status should now be SUCCEEDED, order paymentStatus = COLLECTED
    await request(app.getHttpServer())
      .get(`/api/v1/payments/${paymentId}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200)
      .expect((r) => expect(r.body.status).toBe('SUCCEEDED'));

    // 6. The same webhook delivered twice should be a no-op (idempotent)
    await request(app.getHttpServer())
      .post('/api/v1/payments/webhooks/stripe')
      .set('stripe-signature', 't=1,v1=anything')
      .set('content-type', 'application/json')
      .send(Buffer.from('{}'))
      .expect(204);

    // No double-billing assertion: the orderId payment status remains the
    // same. (If you have an orders endpoint, fetch and confirm.)
    void orderId;
  });
});

function validAddress() {
  return {
    fullName: 'Test Buyer',
    phone: '+15555550100',
    country: 'US',
    region: 'CA',
    city: 'San Francisco',
    postalCode: '94103',
    street: '1 Market St',
  };
}

async function loginAndSeedCart(app: INestApplication): Promise<string> {
  // Replace with the existing test helper from this repo's e2e suite.
  // It must: register a buyer, log them in, add a published variant to cart,
  // and return the JWT.
  throw new Error('TODO: replace with project helper');
}
```

- [ ] **Step 3: Replace the `loginAndSeedCart` stub**

Open the existing e2e test that exercises the place-order flow (likely `test/orders/orders.e2e-spec.ts`). Copy its setup into `loginAndSeedCart` so the test creates the same fixtures. Do not create new helpers — reuse existing ones.

- [ ] **Step 4: Run the test**

Run: `npm run test:e2e -- payments`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add test/payments/
git commit -m "test(payments): e2e card-checkout happy path"
```

---

## Task 18: E2E test — failure path (payment_intent.payment_failed cancels order)

**Files:**
- Modify: `test/payments/payments.e2e-spec.ts`

- [ ] **Step 1: Add a second `it()` block**

Add to `test/payments/payments.e2e-spec.ts` inside the same `describe`:

```ts
it('cancels the order when the payment fails', async () => {
  providerStub.createIntent.mockResolvedValue({
    providerIntentId: 'pi_e2e_2',
    clientSecret: 'pi_e2e_2_secret',
    status: PaymentStatus.REQUIRES_ACTION,
  });

  const placeRes = await request(app.getHttpServer())
    .post('/api/v1/checkout/place-order')
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({
      paymentMethod: 'CARD',
      paymentProvider: 'STRIPE',
      address: validAddress(),
    })
    .expect(201);

  const paymentId = placeRes.body.payment.id;
  const orderId = placeRes.body.order.id;

  providerStub.verifyAndParseWebhook.mockReturnValue({
    providerEventId: 'evt_e2e_2',
    eventType: 'payment_intent.payment_failed',
    providerIntentId: 'pi_e2e_2',
    status: PaymentStatus.FAILED,
    errorMessage: 'card declined',
    raw: {},
  });

  await request(app.getHttpServer())
    .post('/api/v1/payments/webhooks/stripe')
    .set('stripe-signature', 't=1,v1=x')
    .set('content-type', 'application/json')
    .send(Buffer.from('{}'))
    .expect(204);

  await request(app.getHttpServer())
    .get(`/api/v1/payments/${paymentId}`)
    .set('Authorization', `Bearer ${buyerToken}`)
    .expect(200)
    .expect((r) => {
      expect(r.body.status).toBe('FAILED');
      expect(r.body.lastError).toBe('card declined');
    });

  // Buyer's order should now have all sub-orders cancelled
  await request(app.getHttpServer())
    .get(`/api/v1/orders/${orderId}`)
    .set('Authorization', `Bearer ${buyerToken}`)
    .expect(200)
    .expect((r) => {
      expect(r.body.paymentStatus).toBe('FAILED');
      for (const so of r.body.subOrders) {
        expect(so.fulfillmentStatus).toBe('CANCELLED');
      }
    });
});
```

> If the buyer order endpoint path is different in this repo, adjust the URL — the existing e2e in `test/orders/` will show the correct one.

- [ ] **Step 2: Run the test**

Run: `npm run test:e2e -- payments`
Expected: 2 tests pass.

- [ ] **Step 3: Verify the bad-signature path returns 400**

Append a third `it`:

```ts
it('rejects webhook with bad signature', async () => {
  providerStub.verifyAndParseWebhook.mockImplementation(() => {
    throw new Error('Invalid signature');
  });

  await request(app.getHttpServer())
    .post('/api/v1/payments/webhooks/stripe')
    .set('stripe-signature', 't=1,v1=bad')
    .set('content-type', 'application/json')
    .send(Buffer.from('{}'))
    .expect(400);
});
```

Run: `npm run test:e2e -- payments`
Expected: 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add test/payments/payments.e2e-spec.ts
git commit -m "test(payments): e2e failure path + bad signature"
```

---

## Task 19: Final verification & docs

**Files:**
- Modify: `docs/architecture.md` (or wherever payment flow should be documented — check `docs/` index)
- Verify: Swagger renders the new endpoints

- [ ] **Step 1: Run the full test suite**

Run: `npm test && npm run test:e2e`
Expected: all green.

- [ ] **Step 2: Lint + typecheck**

Run: `npm run lint && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Boot and verify Swagger**

Run: `npm run start:dev`. Open `http://localhost:3000/docs`.
Expected: new tags appear:
- `Buyer · Payments` with `GET /v1/payments/{id}`
- `Webhooks · Stripe` with `POST /v1/payments/webhooks/stripe`
And the `Buyer · Checkout` `POST /v1/checkout/place-order` body now lists `paymentProvider` as optional and accepts `CARD` for `paymentMethod`.

Stop the server with Ctrl-C.

- [ ] **Step 4: Document the flow**

Append a section to `docs/architecture.md` (or create `docs/payments.md` if that's cleaner — check what convention the existing docs use):

```markdown
## Payments

The platform supports a multi-gateway abstraction (`PaymentProviderInterface`)
with Stripe shipped as the first concrete adapter. Tap and HyperPay are
planned as additional adapters and require no changes to checkout, orders,
or the webhook controller.

### CARD checkout flow

1. Buyer calls `POST /v1/checkout/place-order` with
   `{ paymentMethod: "CARD", paymentProvider: "STRIPE", address }`.
2. Server creates the order in `paymentStatus = PENDING`, creates a Stripe
   PaymentIntent via `StripeProvider.createIntent`, persists a `payment` row,
   and returns `{ order, payment: { clientSecret, ... } }`.
3. Client confirms the PaymentIntent with the Stripe SDK using the
   returned `clientSecret`.
4. Stripe POSTs to `/v1/payments/webhooks/stripe` with a signed payload.
   `WebhookHandlerService` verifies the signature, deduplicates the event
   by `(provider, providerEventId)`, updates the payment row, and either
   marks the order paid (status = SUCCEEDED) or cancels every sub-order
   in `AWAITING_CONFIRMATION` (status = FAILED / CANCELED).

### Vendor visibility

CARD sub-orders are hidden from vendors until `paymentStatus = COLLECTED`.
COD sub-orders are visible immediately. See
`isSubOrderVendorVisible` in `src/orders/sub-order-state-machine.ts`.

### Adding a new gateway

1. Implement `PaymentProviderInterface` in
   `src/payments/providers/<name>.provider.ts`.
2. Register it in `PaymentProviderRegistry` constructor.
3. Add a webhook controller mirroring `stripe-webhook.controller.ts`
   that calls the same `WebhookHandlerService.handle`.
4. Add raw-body parsing for the new webhook path in `main.ts`.
```

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs(payments): document multi-gateway checkout flow"
```

- [ ] **Step 6: Open the PR**

Run:
```bash
git push -u origin <branch-name>
gh pr create --title "feat: phase 9a — multi-gateway card payments (Stripe)" --body "$(cat <<'EOF'
## Summary
- New `payments` module with multi-gateway abstraction (PaymentProviderInterface + registry); Stripe is the first adapter.
- Card checkout flow: place-order returns clientSecret, webhook flips order to paid (or cancels on failure).
- Sub-orders for unpaid CARD orders are hidden from vendors until payment is collected.
- Migration `1777500000000-CreatePayments` adds payment + payment_event tables and extends OrderPaymentMethod with CARD.

## Test plan
- [ ] `npm test` passes (unit: stripe provider, payments service, webhook handler, orders service)
- [ ] `npm run test:e2e -- payments` passes (happy path, failure path, bad signature)
- [ ] Swagger lists `Buyer · Payments` and `Webhooks · Stripe` tags
- [ ] Webhook idempotency: deliver the same event twice → second call is a no-op
- [ ] Bad signature → 400

## Out of scope
Refunds (9b), commissions + vendor wallet (9c), payouts (9d), Tap/HyperPay adapters.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes

**Spec coverage:** ✅ Multi-gateway abstraction (Tasks 6-8), Stripe adapter (Task 7), card checkout (Tasks 1, 10), webhook handling with idempotency (Tasks 12, 14), order state transitions on payment events (Task 13), vendor visibility gate (Task 11), buyer status endpoint (Task 15), e2e coverage (Tasks 17-18), docs (Task 19).

**Type consistency:** `PaymentProviderName` and `PaymentStatus` are referenced consistently from `src/payments/domain/payment-enums.ts` everywhere; `PaymentProviderInterface.createIntent` returns `CreateIntentResult` which is what `PaymentsService.createForOrder` consumes; `ParsedWebhookEvent` is what `verifyAndParseWebhook` returns and what `WebhookHandlerService.handle` accepts.

**Known follow-ups for 9b:**
- `PaymentProviderInterface.refund(...)` and `PaymentEventAbstractRepository` event types for `charge.refunded`.
- Partial refunds: `payment.refunded_minor` aggregate column.
- Refund DTO + buyer/admin endpoints.

**Known follow-ups for 9c/9d:** Commission rate column on vendor or category, ledger tables (`vendor_balance_entry`), payout entity + scheduled job, Stripe Connect account onboarding (or bank-transfer report generation if multi-gateway abstraction extends to payouts).
