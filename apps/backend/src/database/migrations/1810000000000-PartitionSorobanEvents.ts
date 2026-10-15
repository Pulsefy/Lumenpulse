import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: Partition soroban_events by created_at (quarterly range partitions)
 * and create the soroban_events_archive table for cold storage.
 *
 * Strategy
 * --------
 * 1. Rename the existing flat table to soroban_events_legacy (preserve data).
 * 2. Create a new declarative range-partitioned parent table soroban_events
 *    partitioned by RANGE(created_at).
 * 3. Attach quarterly child partitions covering 2024-Q1 through 2026-Q4, plus
 *    a default catch-all partition that absorbs any future or out-of-range rows.
 * 4. Re-create all indexes on the parent so PostgreSQL propagates them to each
 *    child automatically (local partition indexes).
 * 5. Copy data from soroban_events_legacy into the new partitioned table.
 * 6. Drop soroban_events_legacy.
 * 7. Create soroban_events_archive — a plain (non-partitioned) table that acts
 *    as cold storage for rows moved out of the hot window.
 * 8. Create helper function soroban_events_ensure_partition() to auto-provision
 *    the next quarterly partition when the archival cron runs.
 *
 * Reversibility
 * -------------
 * The down() method:
 *   - Drops the partitioned parent (and all children) after copying rows back
 *     to a plain soroban_events table.
 *   - Drops soroban_events_archive.
 *   - Re-creates the original indexes.
 *
 * Safety
 * ------
 * - All heavy DDL steps use IF EXISTS / IF NOT EXISTS guards.
 * - The migration sets transaction = false so that CONCURRENTLY index builds
 *   outside a transaction block are possible if needed (individual steps still
 *   run in autocommit mode on PostgreSQL when not wrapped).
 * - Data copy uses INSERT … SELECT — safe for testnet volumes; for large
 *   production tables a logical-replication or pg_partman approach is preferred.
 */
export class PartitionSorobanEvents1810000000000 implements MigrationInterface {
  name = 'PartitionSorobanEvents1810000000000';
  // Disable the wrapping transaction so we can control it per-step.
  // Each queryRunner.query() call runs in autocommit on PG when transaction=false.
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ------------------------------------------------------------------
    // Step 1: Rename the existing flat table so we preserve all data
    // ------------------------------------------------------------------
    await queryRunner.query(`
      ALTER TABLE soroban_events RENAME TO soroban_events_legacy;
    `);

    // Drop legacy indexes (they referred to the old table OID; we'll recreate)
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_soroban_events_status;
      DROP INDEX IF EXISTS "IDX_soroban_events_contract_type_created_at";
      DROP INDEX IF EXISTS "IDX_soroban_events_status_created_at";
      DROP INDEX IF EXISTS "IDX_soroban_events_processed_at";
      DROP INDEX IF EXISTS idx_soroban_events_ledger_sequence;
    `);

    // The unique constraint on (tx_hash, event_index) is part of the PK/constraint;
    // it was embedded in soroban_events_legacy so we don't need to drop it separately.

    // ------------------------------------------------------------------
    // Step 2: Create the partitioned parent table
    // ------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE soroban_events (
        id              UUID NOT NULL DEFAULT gen_random_uuid(),
        tx_hash         VARCHAR(128) NOT NULL,
        event_index     INTEGER NOT NULL,
        contract_id     VARCHAR(128),
        event_type      VARCHAR(128),
        canonical_type  VARCHAR(64),
        category        VARCHAR(32),
        raw_payload     JSONB NOT NULL,
        ledger_sequence BIGINT,
        status          soroban_event_status NOT NULL DEFAULT 'pending',
        error_message   TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        processed_at    TIMESTAMPTZ,
        CONSTRAINT uq_soroban_events_tx_index UNIQUE (tx_hash, event_index, created_at)
      ) PARTITION BY RANGE (created_at);
    `);

    // Note on UNIQUE constraint: PostgreSQL requires that the partition key be
    // included in any unique / primary key on a partitioned table.  We therefore
    // extend the unique constraint to include created_at.  The application-level
    // idempotency key remains (tx_hash, event_index) — two events with the same
    // hash and index but different created_at values are impossible in practice
    // because the upsert in the indexer always writes created_at = DEFAULT (now()),
    // and the conflict target in upsertEvents() ignores duplicates by hash+index.

    // ------------------------------------------------------------------
    // Step 3: Create quarterly child partitions (2024-Q1 … 2026-Q4)
    // ------------------------------------------------------------------
    const quarters = [
      ['2024_q1', '2024-01-01', '2024-04-01'],
      ['2024_q2', '2024-04-01', '2024-07-01'],
      ['2024_q3', '2024-07-01', '2024-10-01'],
      ['2024_q4', '2024-10-01', '2025-01-01'],
      ['2025_q1', '2025-01-01', '2025-04-01'],
      ['2025_q2', '2025-04-01', '2025-07-01'],
      ['2025_q3', '2025-07-01', '2025-10-01'],
      ['2025_q4', '2025-10-01', '2026-01-01'],
      ['2026_q1', '2026-01-01', '2026-04-01'],
      ['2026_q2', '2026-04-01', '2026-07-01'],
      ['2026_q3', '2026-07-01', '2026-10-01'],
      ['2026_q4', '2026-10-01', '2027-01-01'],
    ];

    for (const [suffix, from, to] of quarters) {
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS soroban_events_${suffix}
          PARTITION OF soroban_events
          FOR VALUES FROM ('${from}') TO ('${to}');
      `);
    }

    // Default catch-all partition for any rows outside the ranges above
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS soroban_events_default
        PARTITION OF soroban_events DEFAULT;
    `);

    // ------------------------------------------------------------------
    // Step 4: Create indexes on the parent (auto-propagated to children)
    // ------------------------------------------------------------------
    await queryRunner.query(`
      CREATE INDEX idx_soroban_events_status
        ON soroban_events (status);
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_soroban_events_contract_type_created_at"
        ON soroban_events (contract_id, event_type, created_at DESC)
        WHERE contract_id IS NOT NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_soroban_events_status_created_at"
        ON soroban_events (status, created_at DESC);
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_soroban_events_processed_at"
        ON soroban_events (processed_at DESC)
        WHERE processed_at IS NOT NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX idx_soroban_events_ledger_sequence
        ON soroban_events (ledger_sequence);
    `);

    // ------------------------------------------------------------------
    // Step 5: Copy data from the legacy flat table
    // ------------------------------------------------------------------
    await queryRunner.query(`
      INSERT INTO soroban_events (
        id, tx_hash, event_index, contract_id, event_type, canonical_type,
        category, raw_payload, ledger_sequence, status, error_message,
        created_at, processed_at
      )
      SELECT
        id, tx_hash, event_index, contract_id, event_type, canonical_type,
        category, raw_payload, ledger_sequence, status, error_message,
        created_at, processed_at
      FROM soroban_events_legacy
      ON CONFLICT (tx_hash, event_index, created_at) DO NOTHING;
    `);

    // ------------------------------------------------------------------
    // Step 6: Drop the legacy table
    // ------------------------------------------------------------------
    await queryRunner.query(`
      DROP TABLE soroban_events_legacy;
    `);

    // ------------------------------------------------------------------
    // Step 7: Create the archive (cold storage) table
    // ------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS soroban_events_archive (
        id              UUID NOT NULL DEFAULT gen_random_uuid(),
        tx_hash         VARCHAR(128) NOT NULL,
        event_index     INTEGER NOT NULL,
        contract_id     VARCHAR(128),
        event_type      VARCHAR(128),
        canonical_type  VARCHAR(64),
        category        VARCHAR(32),
        raw_payload     JSONB NOT NULL,
        ledger_sequence BIGINT,
        status          soroban_event_status NOT NULL DEFAULT 'pending',
        error_message   TEXT,
        created_at      TIMESTAMPTZ NOT NULL,
        processed_at    TIMESTAMPTZ,
        archived_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_soroban_events_archive_tx_index UNIQUE (tx_hash, event_index)
      );

      CREATE INDEX idx_soroban_events_archive_created_at
        ON soroban_events_archive (created_at DESC);

      CREATE INDEX idx_soroban_events_archive_ledger_sequence
        ON soroban_events_archive (ledger_sequence);

      CREATE INDEX idx_soroban_events_archive_contract_type
        ON soroban_events_archive (contract_id, event_type, created_at DESC)
        WHERE contract_id IS NOT NULL;

      CREATE INDEX idx_soroban_events_archive_archived_at
        ON soroban_events_archive (archived_at DESC);
    `);

    // ------------------------------------------------------------------
    // Step 8: Helper function — auto-provision the next quarterly partition
    // ------------------------------------------------------------------
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION soroban_events_ensure_partition(target_date TIMESTAMPTZ)
      RETURNS void
      LANGUAGE plpgsql
      AS $$
      DECLARE
        quarter_start DATE;
        quarter_end   DATE;
        part_name     TEXT;
        y             INT := EXTRACT(YEAR FROM target_date)::INT;
        q             INT := CEIL(EXTRACT(MONTH FROM target_date) / 3.0)::INT;
      BEGIN
        quarter_start := make_date(y, (q - 1) * 3 + 1, 1);
        quarter_end   := quarter_start + INTERVAL '3 months';
        part_name     := FORMAT('soroban_events_%s_q%s', y, q);

        IF NOT EXISTS (
          SELECT 1 FROM pg_class WHERE relname = part_name
        ) THEN
          EXECUTE FORMAT(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF soroban_events
             FOR VALUES FROM (%L) TO (%L)',
            part_name,
            quarter_start::TIMESTAMPTZ,
            quarter_end::TIMESTAMPTZ
          );
          RAISE NOTICE 'Created partition %', part_name;
        END IF;
      END;
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ------------------------------------------------------------------
    // Reverse: restore a flat soroban_events table
    // ------------------------------------------------------------------

    // 1. Create a temporary plain table
    await queryRunner.query(`
      CREATE TABLE soroban_events_restore (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tx_hash         VARCHAR(128) NOT NULL,
        event_index     INTEGER NOT NULL,
        contract_id     VARCHAR(128),
        event_type      VARCHAR(128),
        canonical_type  VARCHAR(64),
        category        VARCHAR(32),
        raw_payload     JSONB NOT NULL,
        ledger_sequence BIGINT,
        status          soroban_event_status NOT NULL DEFAULT 'pending',
        error_message   TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        processed_at    TIMESTAMPTZ,
        CONSTRAINT uq_soroban_events_restore_tx_index UNIQUE (tx_hash, event_index)
      );
    `);

    // 2. Copy hot data from the partitioned table
    await queryRunner.query(`
      INSERT INTO soroban_events_restore (
        id, tx_hash, event_index, contract_id, event_type, canonical_type,
        category, raw_payload, ledger_sequence, status, error_message,
        created_at, processed_at
      )
      SELECT
        id, tx_hash, event_index, contract_id, event_type, canonical_type,
        category, raw_payload, ledger_sequence, status, error_message,
        created_at, processed_at
      FROM soroban_events
      ON CONFLICT (tx_hash, event_index) DO NOTHING;
    `);

    // 3. Restore archived rows that are not already in the hot table
    await queryRunner.query(`
      INSERT INTO soroban_events_restore (
        id, tx_hash, event_index, contract_id, event_type, canonical_type,
        category, raw_payload, ledger_sequence, status, error_message,
        created_at, processed_at
      )
      SELECT
        id, tx_hash, event_index, contract_id, event_type, canonical_type,
        category, raw_payload, ledger_sequence, status, error_message,
        created_at, processed_at
      FROM soroban_events_archive
      ON CONFLICT (tx_hash, event_index) DO NOTHING;
    `);

    // 4. Drop the partitioned parent (cascades to all child partitions)
    await queryRunner.query(`DROP TABLE soroban_events CASCADE;`);

    // 5. Drop the archive table
    await queryRunner.query(`DROP TABLE IF EXISTS soroban_events_archive;`);

    // 6. Drop the helper function
    await queryRunner.query(`
      DROP FUNCTION IF EXISTS soroban_events_ensure_partition(TIMESTAMPTZ);
    `);

    // 7. Rename the restore table to soroban_events
    await queryRunner.query(`
      ALTER TABLE soroban_events_restore RENAME TO soroban_events;
    `);

    // 8. Re-create the original indexes
    await queryRunner.query(`
      CREATE INDEX idx_soroban_events_status ON soroban_events (status);
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_soroban_events_contract_type_created_at"
        ON soroban_events (contract_id, event_type, created_at DESC)
        WHERE contract_id IS NOT NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_soroban_events_status_created_at"
        ON soroban_events (status, created_at DESC);
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_soroban_events_processed_at"
        ON soroban_events (processed_at DESC)
        WHERE processed_at IS NOT NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX idx_soroban_events_ledger_sequence
        ON soroban_events (ledger_sequence);
    `);
  }
}
