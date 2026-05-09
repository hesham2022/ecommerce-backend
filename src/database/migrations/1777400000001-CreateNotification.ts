import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotification1777400000001 implements MigrationInterface {
  name = 'CreateNotification1777400000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "notification" (` +
        `"id" uuid NOT NULL, ` +
        `"user_id" integer NOT NULL, ` +
        `"type" text NOT NULL, ` +
        `"title_translations" jsonb NOT NULL, ` +
        `"body_translations" jsonb NOT NULL, ` +
        `"data" jsonb NOT NULL DEFAULT '{}'::jsonb, ` +
        `"is_read" boolean NOT NULL DEFAULT false, ` +
        `"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `"read_at" TIMESTAMP WITH TIME ZONE, ` +
        `CONSTRAINT "PK_notification_id" PRIMARY KEY ("id")` +
        `)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_notification_user_created_at" ON "notification" ("user_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_notification_user_unread" ON "notification" ("user_id", "is_read")`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification" ADD CONSTRAINT "FK_notification_user_id" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notification" DROP CONSTRAINT "FK_notification_user_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_notification_user_unread"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_notification_user_created_at"`,
    );
    await queryRunner.query(`DROP TABLE "notification"`);
  }
}
