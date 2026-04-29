import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOutboxEvents1769900000000 implements MigrationInterface {
  name = 'CreateOutboxEvents1769900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "outbox_events_status_enum" AS ENUM ('pending', 'processed', 'failed')`,
    );

    await queryRunner.query(
      `CREATE TABLE "outbox_events" (
        "id"          uuid                            NOT NULL DEFAULT uuid_generate_v4(),
        "eventType"   character varying(255)          NOT NULL,
        "payload"     jsonb                           NOT NULL,
        "status"      "outbox_events_status_enum"     NOT NULL DEFAULT 'pending',
        "attempts"    integer                         NOT NULL DEFAULT 0,
        "lastError"   text,
        "processedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt"   TIMESTAMP WITH TIME ZONE        NOT NULL DEFAULT now(),
        CONSTRAINT "PK_outbox_events" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_outbox_events_status_created" ON "outbox_events" ("status", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_outbox_events_status_created"`);
    await queryRunner.query(`DROP TABLE "outbox_events"`);
    await queryRunner.query(`DROP TYPE "outbox_events_status_enum"`);
  }
}
