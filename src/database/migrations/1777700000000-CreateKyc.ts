import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKyc1777700000000 implements MigrationInterface {
  name = 'CreateKyc1777700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Enum types
    await queryRunner.query(
      `CREATE TYPE "kyc_document_type_enum" AS ENUM (` +
        `'COMMERCIAL_REGISTRATION','TAX_CERTIFICATE','IBAN_DOCUMENT','OWNER_ID'` +
        `)`,
    );
    await queryRunner.query(
      `CREATE TYPE "kyc_document_status_enum" AS ENUM (` +
        `'PENDING','APPROVED','REJECTED'` +
        `)`,
    );
    await queryRunner.query(
      `CREATE TYPE "kyc_status_enum" AS ENUM (` +
        `'NOT_SUBMITTED','PENDING_REVIEW','APPROVED','REJECTED'` +
        `)`,
    );

    // 2. Add kyc_status column to vendor (default NOT_SUBMITTED for existing rows)
    await queryRunner.query(
      `ALTER TABLE "vendor" ADD "kyc_status" "kyc_status_enum" ` +
        `NOT NULL DEFAULT 'NOT_SUBMITTED'`,
    );

    // 3. kyc_document table
    await queryRunner.query(
      `CREATE TABLE "kyc_document" (` +
        `"id" uuid NOT NULL, ` +
        `"vendor_id" uuid NOT NULL, ` +
        `"type" "kyc_document_type_enum" NOT NULL, ` +
        `"file_id" uuid NOT NULL, ` +
        `"status" "kyc_document_status_enum" NOT NULL DEFAULT 'PENDING', ` +
        `"details" jsonb NOT NULL DEFAULT '{}'::jsonb, ` +
        `"reject_reason" text, ` +
        `"superseded_at" TIMESTAMP WITH TIME ZONE, ` +
        `"submitted_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `"reviewed_at" TIMESTAMP WITH TIME ZONE, ` +
        `"reviewed_by_user_id" integer, ` +
        `"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_kyc_document_id" PRIMARY KEY ("id")` +
        `)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_kyc_document_vendor_type_supersedes" ` +
        `ON "kyc_document" ("vendor_id", "type", "superseded_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_kyc_document_status" ON "kyc_document" ("status")`,
    );
    // Partial unique: exactly one current row per (vendor, type)
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_kyc_document_current_per_vendor_type" ` +
        `ON "kyc_document" ("vendor_id", "type") ` +
        `WHERE "superseded_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "kyc_document" ADD CONSTRAINT "FK_kyc_document_vendor_id" ` +
        `FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ` +
        `ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "kyc_document" ADD CONSTRAINT "FK_kyc_document_file_id" ` +
        `FOREIGN KEY ("file_id") REFERENCES "file"("id") ` +
        `ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "kyc_document" ADD CONSTRAINT "FK_kyc_document_reviewed_by_user_id" ` +
        `FOREIGN KEY ("reviewed_by_user_id") REFERENCES "user"("id") ` +
        `ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "kyc_document" DROP CONSTRAINT "FK_kyc_document_reviewed_by_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kyc_document" DROP CONSTRAINT "FK_kyc_document_file_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kyc_document" DROP CONSTRAINT "FK_kyc_document_vendor_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_kyc_document_current_per_vendor_type"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_kyc_document_status"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_kyc_document_vendor_type_supersedes"`,
    );
    await queryRunner.query(`DROP TABLE "kyc_document"`);
    await queryRunner.query(`ALTER TABLE "vendor" DROP COLUMN "kyc_status"`);
    await queryRunner.query(`DROP TYPE "kyc_status_enum"`);
    await queryRunner.query(`DROP TYPE "kyc_document_status_enum"`);
    await queryRunner.query(`DROP TYPE "kyc_document_type_enum"`);
  }
}
