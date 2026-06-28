import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSorobanEventIndexer1800000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // Add ledger_sequence column to soroban_events
    await queryRunner.query(`
      ALTER TABLE soroban_events
        ADD COLUMN IF NOT EXISTS ledger_sequence BIGINT;

      CREATE INDEX IF NOT EXISTS idx_soroban_events_ledger_sequence
        ON soroban_events (ledger_sequence);
    `);

    // Create the indexer cursor table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS soroban_indexer_cursors (
        cursor_key            VARCHAR(128) PRIMARY KEY,
        last_ledger_sequence  BIGINT NOT NULL,
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS soroban_indexer_cursors;

      DROP INDEX IF EXISTS idx_soroban_events_ledger_sequence;

      ALTER TABLE soroban_events
        DROP COLUMN IF EXISTS ledger_sequence;
    `);
  }
}
