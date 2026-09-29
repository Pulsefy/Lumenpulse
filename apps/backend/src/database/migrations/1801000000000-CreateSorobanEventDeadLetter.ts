import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `soroban_event_dead_letter` table.
 *
 * Column names are aligned with the `SorobanEventDeadLetter` entity
 * (camelCase) so the schema produced by the migration set matches the entity
 * definitions used by the application.
 */
export class CreateSorobanEventDeadLetter1801000000000 implements MigrationInterface {
  name = 'CreateSorobanEventDeadLetter1801000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "soroban_event_dead_letter_status_enum" AS ENUM ('pending', 'replaying', 'resolved', 'replayed')`,
    );

    await queryRunner.query(`
      CREATE TABLE "soroban_event_dead_letter" (
        "id"                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "sorobanEventId"        uuid,
        "soroban_event_id"      uuid,
        "txHash"                VARCHAR(128) NOT NULL,
        "eventIndex"            INTEGER NOT NULL,
        "contractId"            VARCHAR(128),
        "eventType"             VARCHAR(128),
        "canonicalType"         VARCHAR(64),
        "category"              VARCHAR(32),
        "rawPayload"            JSONB NOT NULL,
        "ledgerSequence"        BIGINT,
        "failureCount"          INTEGER NOT NULL DEFAULT 0,
        "lastErrorMessage"      TEXT,
        "lastErrorStack"        TEXT,
        "lastAttemptAt"         TIMESTAMPTZ,
        "errorHistory"          JSONB NOT NULL DEFAULT '[]'::jsonb,
        "status"                "soroban_event_dead_letter_status_enum" NOT NULL DEFAULT 'pending',
        "maintainerNotes"       TEXT,
        "replayCount"           INTEGER NOT NULL DEFAULT 0,
        "lastReplayedAt"        TIMESTAMPTZ,
        "resolvedAt"            TIMESTAMPTZ,
        "resolvedBy"            VARCHAR(255),
        "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt"             TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "fk_soroban_event_id" FOREIGN KEY ("soroban_event_id")
          REFERENCES soroban_events("id") ON DELETE SET NULL,
        CONSTRAINT "uq_dlq_tx_index" UNIQUE ("txHash", "eventIndex")
      );
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_dlq_status" ON "soroban_event_dead_letter" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dlq_created_at" ON "soroban_event_dead_letter" ("createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dlq_soroban_event_id" ON "soroban_event_dead_letter" ("sorobanEventId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dlq_status_created_at" ON "soroban_event_dead_letter" ("status", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dlq_unresolved" ON "soroban_event_dead_letter" ("status") WHERE status != 'resolved'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "soroban_event_dead_letter"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "soroban_event_dead_letter_status_enum"`,
    );
  }
}
