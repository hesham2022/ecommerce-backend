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
