import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateChatTables1777340000000 implements MigrationInterface {
  name = 'CreateChatTables1777340000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enums ─────────────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TYPE "public"."conversation_kind_enum" AS ENUM('DIRECT', 'ORDER')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."message_attachment_kind_enum" AS ENUM('image', 'file')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."conversation_report_status_enum" AS ENUM('OPEN', 'RESOLVED')`,
    );

    // ── 1. conversation ───────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE "conversation" (` +
        `"id" uuid NOT NULL, ` +
        `"kind" "public"."conversation_kind_enum" NOT NULL, ` +
        `"vendor_id" uuid NOT NULL, ` +
        `"buyer_id" integer NOT NULL, ` +
        `"suborder_id" uuid, ` +
        `"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `"last_message_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_conversation_id" PRIMARY KEY ("id")` +
        `)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_conversation_buyer" ON "conversation" ("buyer_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_conversation_vendor" ON "conversation" ("vendor_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_conversation_last_message_at" ON "conversation" ("last_message_at" DESC)`,
    );
    // Partial unique indexes
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_conversation_direct_pair" ON "conversation" ("vendor_id", "buyer_id") WHERE "kind" = 'DIRECT' AND "suborder_id" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_conversation_order_suborder" ON "conversation" ("suborder_id") WHERE "kind" = 'ORDER' AND "suborder_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation" ADD CONSTRAINT "FK_conversation_vendor_id" FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation" ADD CONSTRAINT "FK_conversation_buyer_id" FOREIGN KEY ("buyer_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation" ADD CONSTRAINT "FK_conversation_suborder_id" FOREIGN KEY ("suborder_id") REFERENCES "sub_order"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // ── 2. message ────────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE "message" (` +
        `"id" uuid NOT NULL, ` +
        `"conversation_id" uuid NOT NULL, ` +
        `"sender_user_id" integer NOT NULL, ` +
        `"body" text NOT NULL, ` +
        `"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "ck_message_body_length" CHECK (char_length("body") <= 5000), ` +
        `CONSTRAINT "PK_message_id" PRIMARY KEY ("id")` +
        `)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_message_conversation_created_at" ON "message" ("conversation_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `ALTER TABLE "message" ADD CONSTRAINT "FK_message_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "message" ADD CONSTRAINT "FK_message_sender_user_id" FOREIGN KEY ("sender_user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // ── 3. message_attachment ────────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE "message_attachment" (` +
        `"id" uuid NOT NULL, ` +
        `"message_id" uuid NOT NULL, ` +
        `"file_id" uuid NOT NULL, ` +
        `"kind" "public"."message_attachment_kind_enum" NOT NULL, ` +
        `"position" integer NOT NULL, ` +
        `CONSTRAINT "PK_message_attachment_id" PRIMARY KEY ("id")` +
        `)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_message_attachment_message_position" ON "message_attachment" ("message_id", "position")`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_attachment" ADD CONSTRAINT "FK_message_attachment_message_id" FOREIGN KEY ("message_id") REFERENCES "message"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_attachment" ADD CONSTRAINT "FK_message_attachment_file_id" FOREIGN KEY ("file_id") REFERENCES "file"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    // ── 4. conversation_participant ──────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE "conversation_participant" (` +
        `"id" uuid NOT NULL, ` +
        `"conversation_id" uuid NOT NULL, ` +
        `"user_id" integer NOT NULL, ` +
        `"last_read_message_id" uuid, ` +
        `"is_archived" boolean NOT NULL DEFAULT false, ` +
        `"is_blocked" boolean NOT NULL DEFAULT false, ` +
        `"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "uq_conversation_participant_pair" UNIQUE ("conversation_id", "user_id"), ` +
        `CONSTRAINT "PK_conversation_participant_id" PRIMARY KEY ("id")` +
        `)`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_participant" ADD CONSTRAINT "FK_conversation_participant_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_participant" ADD CONSTRAINT "FK_conversation_participant_user_id" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_participant" ADD CONSTRAINT "FK_conversation_participant_last_read_message_id" FOREIGN KEY ("last_read_message_id") REFERENCES "message"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // ── 5. user_block ────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE "user_block" (` +
        `"id" uuid NOT NULL, ` +
        `"blocker_user_id" integer NOT NULL, ` +
        `"blocked_user_id" integer NOT NULL, ` +
        `"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "uq_user_block_pair" UNIQUE ("blocker_user_id", "blocked_user_id"), ` +
        `CONSTRAINT "ck_user_block_not_self" CHECK ("blocker_user_id" != "blocked_user_id"), ` +
        `CONSTRAINT "PK_user_block_id" PRIMARY KEY ("id")` +
        `)`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_block" ADD CONSTRAINT "FK_user_block_blocker" FOREIGN KEY ("blocker_user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_block" ADD CONSTRAINT "FK_user_block_blocked" FOREIGN KEY ("blocked_user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // ── 6. conversation_report ───────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE "conversation_report" (` +
        `"id" uuid NOT NULL, ` +
        `"conversation_id" uuid NOT NULL, ` +
        `"reporter_user_id" integer NOT NULL, ` +
        `"reason" character varying(500) NOT NULL, ` +
        `"status" "public"."conversation_report_status_enum" NOT NULL DEFAULT 'OPEN', ` +
        `"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_conversation_report_id" PRIMARY KEY ("id")` +
        `)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_conversation_report_status_created_at" ON "conversation_report" ("status", "created_at" DESC)`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_report" ADD CONSTRAINT "FK_conversation_report_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_report" ADD CONSTRAINT "FK_conversation_report_reporter_user_id" FOREIGN KEY ("reporter_user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // ── 7. admin_audit_log ───────────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE "admin_audit_log" (` +
        `"id" uuid NOT NULL, ` +
        `"admin_user_id" integer NOT NULL, ` +
        `"action" character varying(64) NOT NULL, ` +
        `"target_type" character varying(64) NOT NULL, ` +
        `"target_id" character varying(64) NOT NULL, ` +
        `"payload" jsonb NOT NULL DEFAULT '{}'::jsonb, ` +
        `"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_admin_audit_log_id" PRIMARY KEY ("id")` +
        `)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_admin_audit_log_admin_created_at" ON "admin_audit_log" ("admin_user_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_admin_audit_log_target" ON "admin_audit_log" ("target_type", "target_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_audit_log" ADD CONSTRAINT "FK_admin_audit_log_admin_user_id" FOREIGN KEY ("admin_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // admin_audit_log
    await queryRunner.query(
      `ALTER TABLE "admin_audit_log" DROP CONSTRAINT "FK_admin_audit_log_admin_user_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_admin_audit_log_target"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_admin_audit_log_admin_created_at"`,
    );
    await queryRunner.query(`DROP TABLE "admin_audit_log"`);

    // conversation_report
    await queryRunner.query(
      `ALTER TABLE "conversation_report" DROP CONSTRAINT "FK_conversation_report_reporter_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_report" DROP CONSTRAINT "FK_conversation_report_conversation_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_conversation_report_status_created_at"`,
    );
    await queryRunner.query(`DROP TABLE "conversation_report"`);

    // user_block
    await queryRunner.query(
      `ALTER TABLE "user_block" DROP CONSTRAINT "FK_user_block_blocked"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_block" DROP CONSTRAINT "FK_user_block_blocker"`,
    );
    await queryRunner.query(`DROP TABLE "user_block"`);

    // conversation_participant
    await queryRunner.query(
      `ALTER TABLE "conversation_participant" DROP CONSTRAINT "FK_conversation_participant_last_read_message_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_participant" DROP CONSTRAINT "FK_conversation_participant_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_participant" DROP CONSTRAINT "FK_conversation_participant_conversation_id"`,
    );
    await queryRunner.query(`DROP TABLE "conversation_participant"`);

    // message_attachment
    await queryRunner.query(
      `ALTER TABLE "message_attachment" DROP CONSTRAINT "FK_message_attachment_file_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_attachment" DROP CONSTRAINT "FK_message_attachment_message_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_message_attachment_message_position"`,
    );
    await queryRunner.query(`DROP TABLE "message_attachment"`);

    // message
    await queryRunner.query(
      `ALTER TABLE "message" DROP CONSTRAINT "FK_message_sender_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "message" DROP CONSTRAINT "FK_message_conversation_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_message_conversation_created_at"`,
    );
    await queryRunner.query(`DROP TABLE "message"`);

    // conversation
    await queryRunner.query(
      `ALTER TABLE "conversation" DROP CONSTRAINT "FK_conversation_suborder_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation" DROP CONSTRAINT "FK_conversation_buyer_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation" DROP CONSTRAINT "FK_conversation_vendor_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_conversation_order_suborder"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_conversation_direct_pair"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_conversation_last_message_at"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_conversation_vendor"`);
    await queryRunner.query(`DROP INDEX "public"."idx_conversation_buyer"`);
    await queryRunner.query(`DROP TABLE "conversation"`);

    // Enums
    await queryRunner.query(
      `DROP TYPE "public"."conversation_report_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."message_attachment_kind_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."conversation_kind_enum"`);
  }
}
