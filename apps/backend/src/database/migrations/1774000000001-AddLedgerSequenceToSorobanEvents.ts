import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLedgerSequenceToSorobanEvents1774000000001 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE soroban_events 
      ADD COLUMN ledger_sequence INTEGER NOT NULL DEFAULT 0;
      
      CREATE INDEX idx_soroban_events_ledger_sequence ON soroban_events (ledger_sequence);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_soroban_events_ledger_sequence;
      ALTER TABLE soroban_events DROP COLUMN IF EXISTS ledger_sequence;
    `);
  }
}
