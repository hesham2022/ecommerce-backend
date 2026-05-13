import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePayouts1778000000000 implements MigrationInterface {
  name = 'CreatePayouts1778000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Enums
    await queryRunner.query(`
      CREATE TYPE "vendor_ledger_entry_type_enum" AS ENUM (
        'EARNING', 'REFUND_CLAWBACK', 'PAYOUT_ISSUED', 'PAYOUT_REVERSED', 'ADJUSTMENT'
      );
    `);
    await queryRunner.query(`
      CREATE TYPE "vendor_payout_status_enum" AS ENUM (
        'PENDING', 'ISSUED', 'PAID', 'FAILED', 'CANCELED'
      );
    `);
    await queryRunner.query(`
      CREATE TYPE "payout_batch_status_enum" AS ENUM (
        'BUILDING', 'READY'
      );
    `);

    // 2. vendor.commission_rate column
    await queryRunner.query(`
      ALTER TABLE "vendor"
      ADD COLUMN "commission_rate" decimal(5,4) NOT NULL DEFAULT 0.1000;
    `);

    // 3. vendor_ledger_entry
    await queryRunner.query(`
      CREATE TABLE "vendor_ledger_entry" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "vendor_id" uuid NOT NULL,
        "type" "vendor_ledger_entry_type_enum" NOT NULL,
        "amount_minor" bigint NOT NULL,
        "currency_code" char(3) NOT NULL,
        "available_at" timestamptz NOT NULL,
        "sub_order_id" uuid NULL,
        "return_id" uuid NULL,
        "payout_id" uuid NULL,
        "admin_user_id" uuid NULL,
        "memo" text NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      ALTER TABLE "vendor_ledger_entry"
      ADD CONSTRAINT "FK_vendor_ledger_entry_vendor"
      FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ON DELETE RESTRICT;
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_vendor_ledger_entry_vendor_available_at"
      ON "vendor_ledger_entry" ("vendor_id", "available_at");
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_vendor_ledger_entry_earning_sub_order"
      ON "vendor_ledger_entry" ("sub_order_id")
      WHERE "type" = 'EARNING';
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_vendor_ledger_entry_clawback_return"
      ON "vendor_ledger_entry" ("return_id")
      WHERE "type" = 'REFUND_CLAWBACK';
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_vendor_ledger_entry_payout"
      ON "vendor_ledger_entry" ("payout_id");
    `);

    // 4. vendor_payout
    await queryRunner.query(`
      CREATE TABLE "vendor_payout" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "vendor_id" uuid NOT NULL,
        "cycle_key" text NOT NULL,
        "amount_minor" bigint NOT NULL,
        "currency_code" char(3) NOT NULL,
        "status" "vendor_payout_status_enum" NOT NULL DEFAULT 'PENDING',
        "iban_snapshot" text NOT NULL,
        "bank_name_snapshot" text NOT NULL,
        "account_holder_snapshot" text NULL,
        "issued_at" timestamptz NULL,
        "paid_at" timestamptz NULL,
        "failed_at" timestamptz NULL,
        "failure_reason" text NULL,
        "admin_user_id" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      ALTER TABLE "vendor_payout"
      ADD CONSTRAINT "FK_vendor_payout_vendor"
      FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ON DELETE RESTRICT;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_vendor_payout_vendor_cycle"
      ON "vendor_payout" ("vendor_id", "cycle_key");
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_vendor_payout_status" ON "vendor_payout" ("status");
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_vendor_payout_cycle" ON "vendor_payout" ("cycle_key");
    `);

    // 5. payout_batch
    await queryRunner.query(`
      CREATE TABLE "payout_batch" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "cycle_key" text NOT NULL,
        "vendor_count" integer NOT NULL DEFAULT 0,
        "total_amount_minor" bigint NOT NULL DEFAULT 0,
        "status" "payout_batch_status_enum" NOT NULL DEFAULT 'BUILDING',
        "created_at" timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_payout_batch_cycle" ON "payout_batch" ("cycle_key");
    `);

    // 6. FK from vendor_ledger_entry.payout_id back to vendor_payout (now that table exists)
    await queryRunner.query(`
      ALTER TABLE "vendor_ledger_entry"
      ADD CONSTRAINT "FK_vendor_ledger_entry_payout"
      FOREIGN KEY ("payout_id") REFERENCES "vendor_payout"("id") ON DELETE RESTRICT;
    `);

    // 7. Seed settings keys into the singleton row (idempotent upsert)
    await queryRunner.query(`
      INSERT INTO "setting" ("id", "values", "updated_at")
      VALUES (1, '{"payout_hold_days": 14, "payout_minimum_amount_minor": "5000", "payout_cycle_cron": "0 9 * * 1", "payout_default_commission_rate": "0.1000"}'::jsonb, now())
      ON CONFLICT ("id") DO UPDATE
        SET "values" = "setting"."values" || EXCLUDED."values",
            "updated_at" = now();
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "setting"
      SET "values" = "values" - 'payout_hold_days'
                              - 'payout_minimum_amount_minor'
                              - 'payout_cycle_cron'
                              - 'payout_default_commission_rate'
      WHERE "id" = 1;
    `);
    await queryRunner.query(
      `ALTER TABLE "vendor_ledger_entry" DROP CONSTRAINT "FK_vendor_ledger_entry_payout";`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_payout_batch_cycle";`);
    await queryRunner.query(`DROP TABLE "payout_batch";`);
    await queryRunner.query(`DROP INDEX "public"."IDX_vendor_payout_cycle";`);
    await queryRunner.query(`DROP INDEX "public"."IDX_vendor_payout_status";`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_vendor_payout_vendor_cycle";`,
    );
    await queryRunner.query(
      `ALTER TABLE "vendor_payout" DROP CONSTRAINT "FK_vendor_payout_vendor";`,
    );
    await queryRunner.query(`DROP TABLE "vendor_payout";`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vendor_ledger_entry_payout";`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_vendor_ledger_entry_clawback_return";`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_vendor_ledger_entry_earning_sub_order";`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vendor_ledger_entry_vendor_available_at";`,
    );
    await queryRunner.query(
      `ALTER TABLE "vendor_ledger_entry" DROP CONSTRAINT "FK_vendor_ledger_entry_vendor";`,
    );
    await queryRunner.query(`DROP TABLE "vendor_ledger_entry";`);
    await queryRunner.query(
      `ALTER TABLE "vendor" DROP COLUMN "commission_rate";`,
    );
    await queryRunner.query(`DROP TYPE "payout_batch_status_enum";`);
    await queryRunner.query(`DROP TYPE "vendor_payout_status_enum";`);
    await queryRunner.query(`DROP TYPE "vendor_ledger_entry_type_enum";`);
  }
}
