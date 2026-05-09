import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrderEventAndPartialPayment1777340000000 implements MigrationInterface {
  name = 'CreateOrderEventAndPartialPayment1777340000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. Add PARTIAL to order_payment_status_enum ──────────────────
    // Postgres requires altering enums in a non-transactional context, but
    // ALTER TYPE … ADD VALUE works inside transactions on PG 12+.
    await queryRunner.query(
      `ALTER TYPE "public"."order_payment_status_enum" ADD VALUE IF NOT EXISTS 'PARTIAL' AFTER 'PENDING'`,
    );

    // ── 2. Create order_event_type_enum ──────────────────────────────
    await queryRunner.query(
      `CREATE TYPE "public"."order_event_type_enum" AS ENUM('STATUS_CHANGED', 'PAYMENT_COLLECTED', 'DELIVERED_BY_BUYER')`,
    );

    // ── 3. Create order_event table ─────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE "order_event" (` +
        `"id" uuid NOT NULL, ` +
        `"sub_order_id" uuid NOT NULL, ` +
        `"event_type" "public"."order_event_type_enum" NOT NULL, ` +
        `"from_status" text, ` +
        `"to_status" text, ` +
        `"actor_user_id" integer, ` +
        `"payload" jsonb, ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_order_event_id" PRIMARY KEY ("id")` +
        `)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_order_event_sub_order_created_at" ON "order_event" ("sub_order_id", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_event" ADD CONSTRAINT "FK_order_event_sub_order_id" FOREIGN KEY ("sub_order_id") REFERENCES "sub_order"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_event" DROP CONSTRAINT "FK_order_event_sub_order_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_order_event_sub_order_created_at"`,
    );
    await queryRunner.query(`DROP TABLE "order_event"`);
    await queryRunner.query(`DROP TYPE "public"."order_event_type_enum"`);

    // Removing a value from a Postgres enum is not safely supported.
    // We rebuild the enum: rename the old, create the new without
    // PARTIAL, migrate the column, drop the old.
    await queryRunner.query(
      `ALTER TYPE "public"."order_payment_status_enum" RENAME TO "order_payment_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."order_payment_status_enum" AS ENUM('PENDING', 'COLLECTED', 'FAILED')`,
    );
    // Any existing PARTIAL rows fall back to PENDING.
    await queryRunner.query(
      `ALTER TABLE "order" ALTER COLUMN "payment_status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "order" ALTER COLUMN "payment_status" TYPE "public"."order_payment_status_enum" USING (CASE WHEN "payment_status"::text = 'PARTIAL' THEN 'PENDING' ELSE "payment_status"::text END)::"public"."order_payment_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order" ALTER COLUMN "payment_status" SET DEFAULT 'PENDING'`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."order_payment_status_enum_old"`,
    );
  }
}
