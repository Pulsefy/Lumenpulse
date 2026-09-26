import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Wave 9 (#1423): Cold-storage archive for `soroban_events`.
 *
 * The hot table grows without bound. This migration adds an append-only
 * archive table that mirrors the hot schema, plus a unique
 * `(txHash, eventIndex)` constraint so archival is idempotent and can be
 * used as the cross-boundary idempotency key by replay/backfill.
 *
 * @acknowledge-destructive
 * `down()` drops the archive table. Rows already archived are lost on
 * rollback; the hot table is untouched, so no live data is affected.
 * Re-running `up()` re-creates an empty archive and the scheduler
 * re-archives eligible rows on the next tick.
 */
export class CreateSorobanEventsArchive1860000000000
  implements MigrationInterface
{
  name = 'CreateSorobanEventsArchive1860000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "soroban_events_archive" (
        "id"              uuid NOT NULL DEFAULT uuid_generate_v4(),
        "originalId"      uuid NOT NULL,
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
        "createdAt"       TIMESTAMPTZ NOT NULL,
        "processedAt"     TIMESTAMPTZ,
        "archivedAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_soroban_events_archive" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_soroban_events_archive_tx_index" UNIQUE ("txHash", "eventIndex")
      );
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_soroban_events_archive_original_id" ON "soroban_events_archive" ("originalId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_soroban_events_archive_ledger" ON "soroban_events_archive" ("ledgerSequence")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_soroban_events_archive_contract_type_created" ON "soroban_events_archive" ("contractId", "eventType", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_soroban_events_archive_archived_at" ON "soroban_events_archive" ("archivedAt")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "soroban_events_archive"`);
  }
}
