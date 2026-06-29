import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSorobanEventDeadLetter1801000000000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE soroban_event_dead_letter_status AS ENUM ('pending', 'resolved', 'replayed');

      CREATE TABLE soroban_event_dead_letter (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        soroban_event_id      UUID,
        tx_hash               VARCHAR(128) NOT NULL,
        event_index           INTEGER NOT NULL,
        contract_id           VARCHAR(128),
        event_type            VARCHAR(128),
        canonical_type        VARCHAR(64),
        category              VARCHAR(32),
        raw_payload           JSONB NOT NULL,
        ledger_sequence       BIGINT,
        failure_count         INTEGER NOT NULL DEFAULT 0,
        last_error_message    TEXT,
        last_error_stack      TEXT,
        last_attempt_at       TIMESTAMPTZ,
        error_history         JSONB NOT NULL DEFAULT '[]'::jsonb,
        status                soroban_event_dead_letter_status NOT NULL DEFAULT 'pending',
        maintainer_notes      TEXT,
        replay_count          INTEGER NOT NULL DEFAULT 0,
        last_replayed_at      TIMESTAMPTZ,
        resolved_at           TIMESTAMPTZ,
        resolved_by           VARCHAR(255),
        created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_soroban_event_id FOREIGN KEY (soroban_event_id)
          REFERENCES soroban_events(id) ON DELETE SET NULL,
        CONSTRAINT uq_dlq_tx_index UNIQUE (tx_hash, event_index)
      );

      CREATE INDEX idx_dlq_status ON soroban_event_dead_letter (status);
      CREATE INDEX idx_dlq_created_at ON soroban_event_dead_letter (created_at);
      CREATE INDEX idx_dlq_soroban_event_id ON soroban_event_dead_letter (soroban_event_id);
      CREATE INDEX idx_dlq_status_created_at ON soroban_event_dead_letter (status, created_at);
      CREATE INDEX idx_dlq_unresolved ON soroban_event_dead_letter (status)
        WHERE status != 'resolved';
      CREATE INDEX idx_dlq_contract_type ON soroban_event_dead_letter (contract_id, event_type);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS soroban_event_dead_letter CASCADE;
      DROP TYPE IF EXISTS soroban_event_dead_letter_status;
    `);
  }
}
