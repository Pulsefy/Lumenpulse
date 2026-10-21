import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Partial indexes for the outbox ↔ soroban event index consistency check:
 * one serves its createdAt window scan, the other its lookup by txHash. Only
 * outbox events that reference a chain operation (`payload.txHash`) are
 * indexed, so their size scales with those rows alone.
 */
export class AddOutboxTxHashIndex1866000000000 implements MigrationInterface {
  name = 'AddOutboxTxHashIndex1866000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_outbox_events_payload_tx_hash"
         ON "outbox_events" (("payload"->>'txHash'))
         WHERE "payload" ? 'txHash'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_outbox_events_tx_ref_created"
         ON "outbox_events" ("createdAt")
         WHERE "payload" ? 'txHash'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_outbox_events_tx_ref_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_outbox_events_payload_tx_hash"`,
    );
  }
}
