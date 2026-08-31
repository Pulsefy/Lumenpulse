import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `soroban_events` table.
 *
 * Column names are aligned with the `SorobanEvent` entity (camelCase) so the
 * schema produced by the migration set matches the entity definitions used by
 * the application.
 */
export class CreateSorobanEvents1774000000000 implements MigrationInterface {
  name = 'CreateSorobanEvents1774000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "soroban_events_status_enum" AS ENUM ('pending', 'processed', 'failed')`,
    );

    await queryRunner.query(`
      CREATE TABLE "soroban_events" (
        "id"              uuid NOT NULL DEFAULT uuid_generate_v4(),
        "txHash"          VARCHAR(128) NOT NULL,
        "eventIndex"      INTEGER NOT NULL,
        "contractId"      VARCHAR(128),
        "eventType"       VARCHAR(128),
        "canonicalType"   VARCHAR(64),
        "category"        VARCHAR(32),
        "rawPayload"      JSONB NOT NULL,
        "ledgerSequence"  BIGINT,
        "status"          "soroban_events_status_enum" NOT NULL DEFAULT 'pending',
        "errorMessage"    TEXT,
        "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        "processedAt"     TIMESTAMPTZ,
        CONSTRAINT "PK_soroban_events" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_soroban_events_tx_index" UNIQUE ("txHash", "eventIndex")
      );
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_soroban_events_status" ON "soroban_events" ("status")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS soroban_events;
      DROP TYPE IF EXISTS "soroban_events_status_enum";
    `);
  }
}
