import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `notification_preferences` and `notification_delivery_logs`
 * tables. Previously applied as ad-hoc SQL files under `src/migrations`;
 * moved here so the whole schema is produced by tracked TypeORM migrations.
 */
export class CreateNotificationPreferencesAndDeliveryLogs1840000000000 implements MigrationInterface {
  name = 'CreateNotificationPreferencesAndDeliveryLogs1840000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "notification_preferences" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "enabledChannels" jsonb NOT NULL DEFAULT '["in_app"]', "eventPreferences" jsonb NOT NULL DEFAULT '{}', "quietHours" jsonb, "dailyLimit" integer NOT NULL DEFAULT 0, "minSeverity" character varying(20) NOT NULL DEFAULT 'low', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_notification_preferences" PRIMARY KEY ("id"), CONSTRAINT "UQ_notification_preferences_user" UNIQUE ("userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_preferences_userId" ON "notification_preferences" ("userId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification_preferences" ADD CONSTRAINT "FK_notification_preferences_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE TYPE "notification_delivery_logs_channel_enum" AS ENUM ('in_app', 'email', 'push', 'webhook', 'sms')`,
    );
    await queryRunner.query(
      `CREATE TYPE "notification_delivery_logs_status_enum" AS ENUM ('pending', 'sent', 'delivered', 'failed', 'skipped')`,
    );
    await queryRunner.query(
      `CREATE TYPE "notification_delivery_logs_severity_enum" AS ENUM ('low', 'medium', 'high', 'critical')`,
    );
    await queryRunner.query(
      `CREATE TABLE "notification_delivery_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "notificationId" uuid NOT NULL, "userId" uuid NOT NULL, "channel" "notification_delivery_logs_channel_enum" NOT NULL, "status" "notification_delivery_logs_status_enum" NOT NULL DEFAULT 'pending', "eventCategory" character varying(50), "severity" "notification_delivery_logs_severity_enum", "errorMessage" text, "retryCount" integer NOT NULL DEFAULT 0, "metadata" jsonb, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_notification_delivery_logs" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_delivery_logs_notificationId" ON "notification_delivery_logs" ("notificationId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_delivery_logs_userId" ON "notification_delivery_logs" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_delivery_logs_channel_status" ON "notification_delivery_logs" ("channel", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_delivery_logs_createdAt" ON "notification_delivery_logs" ("createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_delivery_logs_user_created" ON "notification_delivery_logs" ("userId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_delivery_logs_status_retry" ON "notification_delivery_logs" ("status", "retryCount")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notification_delivery_logs"`);
    await queryRunner.query(
      `DROP TYPE "notification_delivery_logs_severity_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "notification_delivery_logs_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "notification_delivery_logs_channel_enum"`,
    );
    await queryRunner.query(`DROP TABLE "notification_preferences"`);
  }
}
