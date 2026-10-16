import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: Partition soroban_events by created_at (monthly RANGE partitions)
 *
 * Strategy
 * --------
 * PostgreSQL does not support converting a plain heap table to a partitioned
 * table in-place.  We therefore use a safe online rename swap:
 *
 *   1. Rename the existing flat table to soroban_events_legacy.
 *   2. Create a new RANGE-partitioned parent soroban_events.
 *   3. Create child partitions covering the last 6 months plus the next 3
 *      months, with "before" and "future" catch-all guards.
 *   4. Copy every row from soroban_events_legacy into the new partitioned table.
 *   5. Create soroban_events_archive (plain table, same schema) for cold storage.
 *   6. Create a soroban_events_all VIEW = partitioned hot UNION ALL archive.
 *   7. Re-apply all indexes on the new partitioned parent.
 *
 * Down / Rollback
 * ---------------
 *   1. Drop the new partitioned table and related objects.
 *   2. Rename soroban_events_legacy back to soroban_events.
 *   3. Restore original indexes.
 *
 * Performance note
 * ----------------
 *   The COPY step (step 4) is O(n) in the existing row count.
 *   For very large tables set `maintenance_work_mem = '512MB'` beforehand,
 *   or perform the copy in batches outside of migrations during a maintenance
 *   window.
 *
 * Partition layout (generated at migration run time):
 *   soroban_events_before       — MINVALUE … 6 months ago (overflow guard)
 *   soroban_events_y{YYYY}m{MM} — one child per calendar month (-6 … +3)
 *   soroban_events_future       — 4 months ahead … MAXVALUE (overflow guard)
 *
 * transaction = false is required for CREATE INDEX CONCURRENTLY.
 */
export class PartitionSorobanEvents1810000000000 implements MigrationInterface {
  name = 'PartitionSorobanEvents1810000000000';
  transaction = false; // required for CONCURRENTLY operations

  // ---------------------------------------------------------------------------
  // UP
  // ---------------------------------------------------------------------------
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Step 0: drop existing indexes so the rename can proceed cleanly ───────
    // They will be re-created on the new partitioned parent below.
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "IDX_soroban_events_contract_type_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "IDX_soroban_events_status_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS "IDX_soroban_events_processed_at"`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS idx_soroban_events_status`,
    );
    await queryRunner.query(
      `DROP INDEX CONCURRENTLY IF EXISTS idx_soroban_events_ledger_sequence`,
    );

    // ── Step 1: rename existing flat table to legacy ──────────────────────────
    await queryRunner.query(
      `ALTER TABLE IF EXISTS soroban_events RENAME TO soroban_events_legacy`,
    );

    await queryRunner.query(`
      ALTER TABLE IF EXISTS soroban_events_legacy
        RENAME CONSTRAINT uq_soroban_events_tx_index
          TO uq_soroban_events_legacy_tx_index
    `);

    // ── Step 2: create partitioned parent ────────────────────────────────────
    // The primary key and unique constraint must include the partition key
    // (created_at) per PostgreSQL requirements for partitioned tables.
    await queryRunner.query(`
      CREATE TABLE soroban_events (
        id              UUID            NOT NULL DEFAULT gen_random_uuid(),
        tx_hash         VARCHAR(128)    NOT NULL,
        event_index     INTEGER         NOT NULL,
        contract_id     VARCHAR(128),
        event_type      VARCHAR(128),
        canonical_type  VARCHAR(64),
        category        VARCHAR(32),
        raw_payload     JSONB           NOT NULL,
        ledger_sequence BIGINT,
        status          soroban_event_status NOT NULL DEFAULT 'pending',
        error_message   TEXT,
        created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
        processed_at    TIMESTAMPTZ,
        CONSTRAINT pk_soroban_events       PRIMARY KEY (id, created_at),
        CONSTRAINT uq_soroban_events_tx_index
          UNIQUE (tx_hash, event_index, created_at)
      ) PARTITION BY RANGE (created_at)
    `);

    // ── Step 3: child partitions ──────────────────────────────────────────────
    await this.createPartitions(queryRunner);

    // ── Step 4: copy legacy data into the partitioned table ───────────────────
    await queryRunner.query(`
      INSERT INTO soroban_events
      SELECT * FROM soroban_events_legacy
      ON CONFLICT (tx_hash, event_index, created_at) DO NOTHING
    `);

    // ── Step 5: archive table (cold / long-term storage) ─────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS soroban_events_archive (
        LIKE soroban_events INCLUDING DEFAULTS INCLUDING CONSTRAINTS
      )
    `);

    await queryRunner.query(`
      ALTER TABLE soroban_events_archive
        ADD CONSTRAINT IF NOT EXISTS uq_soroban_events_archive_tx_index
          UNIQUE (tx_hash, event_index, created_at)
    `);

    // ── Step 6: unified view for hot + archive ────────────────────────────────
    await queryRunner.query(`
      CREATE OR REPLACE VIEW soroban_events_all AS
        SELECT * FROM soroban_events
        UNION ALL
        SELECT * FROM soroban_events_archive
    `);

    // ── Step 7: recreate indexes on the new partitioned parent ────────────────
    // PostgreSQL propagates parent-level indexes to all existing and future
    // child partitions automatically.

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_soroban_events_status
        ON soroban_events (status)
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_soroban_events_ledger_sequence
        ON soroban_events (ledger_sequence)
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_soroban_events_contract_type_created_at"
        ON soroban_events (contract_id, event_type, created_at DESC)
        WHERE contract_id IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_soroban_events_status_created_at"
        ON soroban_events (status, created_at DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_soroban_events_processed_at"
        ON soroban_events (processed_at DESC)
        WHERE processed_at IS NOT NULL
    `);

    // Archive table indexes
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_soroban_events_archive_status
        ON soroban_events_archive (status)
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_soroban_events_archive_ledger
        ON soroban_events_archive (ledger_sequence)
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_soroban_events_archive_contract
        ON soroban_events_archive (contract_id, event_type, created_at DESC)
        WHERE contract_id IS NOT NULL
    `);

    // ── Step 8: document the policy in pg_description ─────────────────────────
    await queryRunner.query(`
      COMMENT ON TABLE soroban_events IS
        'Hot Soroban event store. Partitioned by created_at (monthly RANGE). '
        'Rows older than SOROBAN_HOT_WINDOW_DAYS (default 90) are moved '
        'nightly to soroban_events_archive by SorobanEventsRetentionService.'
    `);

    await queryRunner.query(`
      COMMENT ON TABLE soroban_events_archive IS
        'Cold Soroban event archive. Rows moved here from soroban_events by '
        'the nightly retention job once they exceed the hot window. '
        'Query via soroban_events_all view for full history.'
    `);

    await queryRunner.query(`
      COMMENT ON VIEW soroban_events_all IS
        'UNION ALL of soroban_events (hot, partitioned) and '
        'soroban_events_archive (cold). Use for cross-boundary replay / '
        'backfill queries that must span the hot-window boundary.'
    `);
  }

  // ---------------------------------------------------------------------------
  // DOWN
  // ---------------------------------------------------------------------------
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW IF EXISTS soroban_events_all`);
    await queryRunner.query(`DROP TABLE IF EXISTS soroban_events_archive`);
    await queryRunner.query(`DROP TABLE IF EXISTS soroban_events`);

    // Restore the legacy flat table
    await queryRunner.query(`
      ALTER TABLE IF EXISTS soroban_events_legacy
        RENAME CONSTRAINT uq_soroban_events_legacy_tx_index
          TO uq_soroban_events_tx_index
    `);

    await queryRunner.query(
      `ALTER TABLE IF EXISTS soroban_events_legacy RENAME TO soroban_events`,
    );

    // Restore original indexes
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_soroban_events_status
        ON soroban_events (status)
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_soroban_events_ledger_sequence
        ON soroban_events (ledger_sequence)
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_soroban_events_contract_type_created_at"
        ON soroban_events (contract_id, event_type, created_at DESC)
        WHERE contract_id IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_soroban_events_status_created_at"
        ON soroban_events (status, created_at DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_soroban_events_processed_at"
        ON soroban_events (processed_at DESC)
        WHERE processed_at IS NOT NULL
    `);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Create monthly RANGE child partitions spanning -6 to +3 months relative
   * to the current month, plus "before" and "future" catch-all guards.
   */
  private async createPartitions(queryRunner: QueryRunner): Promise<void> {
    const now = new Date();
    const anchor = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );

    // "before" guard: MINVALUE … start of the covered range
    const rangeStart = this.addMonths(anchor, -6);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS soroban_events_before
        PARTITION OF soroban_events
        FOR VALUES FROM (MINVALUE) TO ('${this.toIso(rangeStart)}')
    `);

    // Monthly partitions: -6 through +3
    for (let offset = -6; offset <= 3; offset++) {
      const lo = this.addMonths(anchor, offset);
      const hi = this.addMonths(anchor, offset + 1);
      const name = this.partitionName(lo);

      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS ${name}
          PARTITION OF soroban_events
          FOR VALUES FROM ('${this.toIso(lo)}') TO ('${this.toIso(hi)}')
      `);
    }

    // "future" guard: end of covered range … MAXVALUE
    const rangeEnd = this.addMonths(anchor, 4);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS soroban_events_future
        PARTITION OF soroban_events
        FOR VALUES FROM ('${this.toIso(rangeEnd)}') TO (MAXVALUE)
    `);
  }

  private addMonths(date: Date, months: number): Date {
    const d = new Date(date);
    d.setUTCMonth(d.getUTCMonth() + months);
    return d;
  }

  /** ISO timestamp string suitable for partition bounds: "YYYY-MM-01 00:00:00+00" */
  private toIso(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}-01 00:00:00+00`;
  }

  /** Table name e.g. soroban_events_y2025m04 */
  private partitionName(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `soroban_events_y${y}m${m}`;
  }
}
