import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReviewTables1777345000000 implements MigrationInterface {
  name = 'CreateReviewTables1777345000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enum ──────────────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TYPE "public"."review_status_enum" AS ENUM('PUBLISHED', 'HIDDEN', 'REPORTED')`,
    );

    // ── 1. review ─────────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE "review" (` +
        `"id" uuid NOT NULL, ` +
        `"order_item_id" uuid NOT NULL, ` +
        `"product_id" uuid NOT NULL, ` +
        `"vendor_id" uuid NOT NULL, ` +
        `"buyer_id" integer NOT NULL, ` +
        `"rating" smallint NOT NULL, ` +
        `"body" text NOT NULL, ` +
        `"status" "public"."review_status_enum" NOT NULL DEFAULT 'PUBLISHED', ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updated_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "uq_review_order_item_id" UNIQUE ("order_item_id"), ` +
        `CONSTRAINT "ck_review_rating_range" CHECK ("rating" BETWEEN 1 AND 5), ` +
        `CONSTRAINT "ck_review_body_length" CHECK (char_length("body") <= 2000), ` +
        `CONSTRAINT "PK_review_id" PRIMARY KEY ("id")` +
        `)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_review_product_status_created" ON "review" ("product_id", "status", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_review_vendor_status_created" ON "review" ("vendor_id", "status", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_review_buyer_id" ON "review" ("buyer_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "review" ADD CONSTRAINT "FK_review_order_item_id" FOREIGN KEY ("order_item_id") REFERENCES "order_item"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "review" ADD CONSTRAINT "FK_review_product_id" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "review" ADD CONSTRAINT "FK_review_vendor_id" FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "review" ADD CONSTRAINT "FK_review_buyer_id" FOREIGN KEY ("buyer_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    // ── 2. review_media ───────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE "review_media" (` +
        `"id" uuid NOT NULL, ` +
        `"review_id" uuid NOT NULL, ` +
        `"file_id" uuid NOT NULL, ` +
        `"position" integer NOT NULL, ` +
        `CONSTRAINT "ck_review_media_position_non_negative" CHECK ("position" >= 0), ` +
        `CONSTRAINT "PK_review_media_id" PRIMARY KEY ("id")` +
        `)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_review_media_review_position" ON "review_media" ("review_id", "position")`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_media" ADD CONSTRAINT "FK_review_media_review_id" FOREIGN KEY ("review_id") REFERENCES "review"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_media" ADD CONSTRAINT "FK_review_media_file_id" FOREIGN KEY ("file_id") REFERENCES "file"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    // ── 3. vendor_response ────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE "vendor_response" (` +
        `"id" uuid NOT NULL, ` +
        `"review_id" uuid NOT NULL, ` +
        `"body" text NOT NULL, ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updated_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "uq_vendor_response_review_id" UNIQUE ("review_id"), ` +
        `CONSTRAINT "ck_vendor_response_body_length" CHECK (char_length("body") <= 2000), ` +
        `CONSTRAINT "PK_vendor_response_id" PRIMARY KEY ("id")` +
        `)`,
    );
    await queryRunner.query(
      `ALTER TABLE "vendor_response" ADD CONSTRAINT "FK_vendor_response_review_id" FOREIGN KEY ("review_id") REFERENCES "review"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // ── 4. admin_audit_log ────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE "admin_audit_log" (` +
        `"id" uuid NOT NULL, ` +
        `"admin_user_id" integer NOT NULL, ` +
        `"action" character varying(64) NOT NULL, ` +
        `"target_type" character varying(64) NOT NULL, ` +
        `"target_id" character varying(64) NOT NULL, ` +
        `"payload" jsonb NOT NULL DEFAULT '{}'::jsonb, ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_admin_audit_log_id" PRIMARY KEY ("id")` +
        `)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_admin_audit_target" ON "admin_audit_log" ("target_type", "target_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_admin_audit_created_at" ON "admin_audit_log" ("created_at" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // admin_audit_log
    await queryRunner.query(`DROP INDEX "public"."idx_admin_audit_created_at"`);
    await queryRunner.query(`DROP INDEX "public"."idx_admin_audit_target"`);
    await queryRunner.query(`DROP TABLE "admin_audit_log"`);

    // vendor_response
    await queryRunner.query(
      `ALTER TABLE "vendor_response" DROP CONSTRAINT "FK_vendor_response_review_id"`,
    );
    await queryRunner.query(`DROP TABLE "vendor_response"`);

    // review_media
    await queryRunner.query(
      `ALTER TABLE "review_media" DROP CONSTRAINT "FK_review_media_file_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "review_media" DROP CONSTRAINT "FK_review_media_review_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_review_media_review_position"`,
    );
    await queryRunner.query(`DROP TABLE "review_media"`);

    // review
    await queryRunner.query(
      `ALTER TABLE "review" DROP CONSTRAINT "FK_review_buyer_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "review" DROP CONSTRAINT "FK_review_vendor_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "review" DROP CONSTRAINT "FK_review_product_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "review" DROP CONSTRAINT "FK_review_order_item_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_review_buyer_id"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_review_vendor_status_created"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_review_product_status_created"`,
    );
    await queryRunner.query(`DROP TABLE "review"`);

    // enum
    await queryRunner.query(`DROP TYPE "public"."review_status_enum"`);
  }
}
