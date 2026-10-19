import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `notifications` table. The `Notification` entity had no
 * corresponding migration, so the table was never created by a tracked
 * migration and the schema-drift check in CI flagged it as missing.
 */
export class CreateNotifications1842000000000 implements MigrationInterface {
  name = 'CreateNotifications1842000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "type" character varying(50) NOT NULL, "title" character varying(255) NOT NULL, "message" text NOT NULL, "severity" character varying(20) NOT NULL DEFAULT 'low', "metadata" jsonb, "read" boolean NOT NULL DEFAULT false, "userId" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_notifications" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_user_created" ON "notifications" ("userId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_read" ON "notifications" ("read")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_type" ON "notifications" ("type")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_severity" ON "notifications" ("severity")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_createdAt" ON "notifications" ("createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_userId" ON "notifications" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notifications"`);
  }
}
