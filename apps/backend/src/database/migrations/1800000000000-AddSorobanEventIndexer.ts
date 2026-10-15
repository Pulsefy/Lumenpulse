import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSorobanEventIndexer1800000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // Add ledger_sequence column to soroban_events
    await queryRunner.query(`
      ALTER TABLE soroban_events
        ADD COLUMN IF NOT EXISTS "ledgerSequence" BIGINT;

      CREATE INDEX IF NOT EXISTS idx_soroban_events_ledger_sequence
        ON soroban_events ("ledgerSequence");
    `);

    // Create the indexer cursor table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "soroban_indexer_cursors" (
        "cursorKey"           VARCHAR(128) PRIMARY KEY,
        "lastLedgerSequence"  BIGINT NOT NULL,
        "updatedAt"           TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "soroban_indexer_cursors";

      DROP INDEX IF EXISTS idx_soroban_events_ledger_sequence;

      ALTER TABLE soroban_events
        DROP COLUMN IF EXISTS "ledgerSequence";
    `);
  }
}
