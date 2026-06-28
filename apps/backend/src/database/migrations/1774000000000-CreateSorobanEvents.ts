import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSorobanEvents1774000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE soroban_event_status AS ENUM ('pending', 'processed', 'failed');

      CREATE TABLE soroban_events (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tx_hash         VARCHAR(128) NOT NULL,
        event_index     INTEGER NOT NULL,
        contract_id     VARCHAR(128),
        event_type      VARCHAR(128),
        raw_payload     JSONB NOT NULL,
        status          soroban_event_status NOT NULL DEFAULT 'pending',
        error_message   TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        processed_at    TIMESTAMPTZ,
        CONSTRAINT uq_soroban_events_tx_index UNIQUE (tx_hash, event_index)
      );

      CREATE INDEX idx_soroban_events_status ON soroban_events (status);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS soroban_events;
      DROP TYPE IF EXISTS soroban_event_status;
    `);
  }
}
