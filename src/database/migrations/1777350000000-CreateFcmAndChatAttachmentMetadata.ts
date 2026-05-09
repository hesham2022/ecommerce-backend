import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFcmAndChatAttachmentMetadata1777350000000 implements MigrationInterface {
  name = 'CreateFcmAndChatAttachmentMetadata1777350000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."fcm_token_platform_enum" AS ENUM('ios', 'android')`,
    );
    await queryRunner.query(
      `CREATE TABLE "fcm_token" (` +
        `"id" uuid NOT NULL, ` +
        `"user_id" integer NOT NULL, ` +
        `"token" text NOT NULL, ` +
        `"platform" "public"."fcm_token_platform_enum" NOT NULL, ` +
        `"device_id" text NOT NULL, ` +
        `"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `"last_used_at" TIMESTAMP WITH TIME ZONE, ` +
        `CONSTRAINT "PK_fcm_token_id" PRIMARY KEY ("id")` +
        `)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_fcm_token_token" ON "fcm_token" ("token")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_fcm_token_user_id" ON "fcm_token" ("user_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "fcm_token" ADD CONSTRAINT "FK_fcm_token_user_id" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`ALTER TABLE "file" ADD "user_id" integer`);
    await queryRunner.query(
      `ALTER TABLE "file" ADD "purpose" character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "file" ADD "mime_type" character varying(128)`,
    );
    await queryRunner.query(`ALTER TABLE "file" ADD "size_bytes" bigint`);
    await queryRunner.query(
      `ALTER TABLE "file" ADD "is_confirmed" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`ALTER TABLE "file" ADD "variants" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "file" ADD "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "file" ADD "confirmed_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_file_user_purpose_created_at" ON "file" ("user_id", "purpose", "created_at" DESC)`,
    );
    await queryRunner.query(
      `ALTER TABLE "file" ADD CONSTRAINT "FK_file_user_id" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "file" DROP CONSTRAINT "FK_file_user_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_file_user_purpose_created_at"`,
    );
    await queryRunner.query(`ALTER TABLE "file" DROP COLUMN "confirmed_at"`);
    await queryRunner.query(`ALTER TABLE "file" DROP COLUMN "created_at"`);
    await queryRunner.query(`ALTER TABLE "file" DROP COLUMN "variants"`);
    await queryRunner.query(`ALTER TABLE "file" DROP COLUMN "is_confirmed"`);
    await queryRunner.query(`ALTER TABLE "file" DROP COLUMN "size_bytes"`);
    await queryRunner.query(`ALTER TABLE "file" DROP COLUMN "mime_type"`);
    await queryRunner.query(`ALTER TABLE "file" DROP COLUMN "purpose"`);
    await queryRunner.query(`ALTER TABLE "file" DROP COLUMN "user_id"`);

    await queryRunner.query(
      `ALTER TABLE "fcm_token" DROP CONSTRAINT "FK_fcm_token_user_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_fcm_token_user_id"`);
    await queryRunner.query(`DROP INDEX "public"."uq_fcm_token_token"`);
    await queryRunner.query(`DROP TABLE "fcm_token"`);
    await queryRunner.query(`DROP TYPE "public"."fcm_token_platform_enum"`);
  }
}
