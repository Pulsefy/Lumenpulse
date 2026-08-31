import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * @acknowledge-destructive Drops and recreates the `outbox_events_status_enum`
 * type to introduce the `dead_letter` status. The old type is dropped only
 * after the column is cast to the new type, so no data is lost. Accepted by
 * the backend team as a deliberate enum evolution.
 *
 * Adds the `dead_letter` status and `deadLetterAt` column to the outbox.
 *
 * The enum is recreated (rather than `ALTER TYPE ... ADD VALUE`) so the
 * migration can run inside a transaction.
 */
export class AddOutboxDeadLetter1832000000000 implements MigrationInterface {
  name = 'AddOutboxDeadLetter1832000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "outbox_events_status_enum_new" AS ENUM ('pending', 'processed', 'failed', 'dead_letter')`,
    );

    await queryRunner.query(
      `ALTER TABLE "outbox_events" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "outbox_events" ALTER COLUMN "status" TYPE "outbox_events_status_enum_new" USING ("status"::text)::"outbox_events_status_enum_new"`,
    );
    await queryRunner.query(
      `ALTER TABLE "outbox_events" ALTER COLUMN "status" SET DEFAULT 'pending'::"outbox_events_status_enum_new"`,
    );

    await queryRunner.query(`DROP TYPE "outbox_events_status_enum"`);
    await queryRunner.query(
      `ALTER TYPE "outbox_events_status_enum_new" RENAME TO "outbox_events_status_enum"`,
    );

    await queryRunner.query(
      `ALTER TABLE "outbox_events" ADD COLUMN "deadLetterAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "outbox_events" DROP COLUMN "deadLetterAt"`,
    );

    await queryRunner.query(
      `CREATE TYPE "outbox_events_status_enum_old" AS ENUM ('pending', 'processed', 'failed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "outbox_events" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "outbox_events" ALTER COLUMN "status" TYPE "outbox_events_status_enum_old" USING ("status"::text)::"outbox_events_status_enum_old"`,
    );
    await queryRunner.query(
      `ALTER TABLE "outbox_events" ALTER COLUMN "status" SET DEFAULT 'pending'::"outbox_events_status_enum_old"`,
    );

    await queryRunner.query(`DROP TYPE "outbox_events_status_enum"`);
    await queryRunner.query(
      `ALTER TYPE "outbox_events_status_enum_old" RENAME TO "outbox_events_status_enum"`,
    );
  }
}
