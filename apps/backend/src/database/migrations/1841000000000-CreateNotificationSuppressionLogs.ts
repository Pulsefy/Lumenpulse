import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `notification_suppression_logs` table used to record when a
 * notification is suppressed during fanout. Previously applied as an ad-hoc
 * SQL file under `src/migrations`; moved here so the whole schema is produced
 * by tracked TypeORM migrations.
 */
export class CreateNotificationSuppressionLogs1841000000000 implements MigrationInterface {
  name = 'CreateNotificationSuppressionLogs1841000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "notification_suppression_logs_reason_enum" AS ENUM ('quiet_hours', 'severity_threshold', 'daily_limit', 'event_category_disabled', 'not_in_watchlist', 'no_preferences', 'channel_unavailable')`,
    );
    await queryRunner.query(
      `CREATE TABLE "notification_suppression_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "eventCategory" character varying(50) NOT NULL, "notificationType" character varying(50) NOT NULL, "reason" "notification_suppression_logs_reason_enum" NOT NULL, "metadata" jsonb, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_notification_suppression_logs" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_suppression_logs_userId" ON "notification_suppression_logs" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_suppression_logs_eventCategory" ON "notification_suppression_logs" ("eventCategory")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_suppression_logs_reason" ON "notification_suppression_logs" ("reason")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_suppression_logs_createdAt" ON "notification_suppression_logs" ("createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_suppression_logs_user_event" ON "notification_suppression_logs" ("userId", "eventCategory")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notification_suppression_logs"`);
    await queryRunner.query(
      `DROP TYPE "notification_suppression_logs_reason_enum"`,
    );
  }
}
