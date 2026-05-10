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
    await queryRunner.query(
      `DROP INDEX "public"."idx_return_attachment_request"`,
    );
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
    await queryRunner.query(
      `DROP INDEX "public"."idx_return_request_sub_order"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_return_request_vendor_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_return_request_buyer_created_at"`,
    );
    await queryRunner.query(`DROP TABLE "return_request"`);
    await queryRunner.query(`DROP TYPE "return_reason_enum"`);
    await queryRunner.query(`DROP TYPE "return_status_enum"`);
    // Note: ALTER TYPE ... ADD VALUE is not reversible. The 7 RETURN_*
    // enum values stay in order_event_type_enum on rollback. Safe — no
    // events with those values exist if the migration is rolled back cleanly.
  }
}
