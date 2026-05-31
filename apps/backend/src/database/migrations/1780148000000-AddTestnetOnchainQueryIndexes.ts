import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTestnetOnchainQueryIndexes1780148000000 implements MigrationInterface {
  name = 'AddTestnetOnchainQueryIndexes1780148000000';
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_soroban_events_contract_type_created_at"
        ON "soroban_events" ("contractId", "eventType", "createdAt" DESC)
        WHERE "contractId" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_soroban_events_status_created_at"
        ON "soroban_events" ("status", "createdAt" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_soroban_events_processed_at"
        ON "soroban_events" ("processedAt" DESC)
        WHERE "processedAt" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_portfolio_snapshots_user_created_at_desc"
        ON "portfolio_snapshots" ("userId", "createdAt" DESC)
        INCLUDE ("totalValueUsd")
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_materialized_snapshots_updated_at"
        ON "portfolio_materialized_snapshots" ("updatedAt" DESC)
        INCLUDE ("userId", "totalValueUsd", "hasLinkedAccount")
    `);

    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_materialized_snapshots_source_snapshot"
        ON "portfolio_materialized_snapshots" ("source_snapshot_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX CONCURRENTLY IF EXISTS "public"."IDX_materialized_snapshots_source_snapshot"
    `);

    await queryRunner.query(`
      DROP INDEX CONCURRENTLY IF EXISTS "public"."IDX_materialized_snapshots_updated_at"
    `);

    await queryRunner.query(`
      DROP INDEX CONCURRENTLY IF EXISTS "public"."IDX_portfolio_snapshots_user_created_at_desc"
    `);

    await queryRunner.query(`
      DROP INDEX CONCURRENTLY IF EXISTS "public"."IDX_soroban_events_processed_at"
    `);

    await queryRunner.query(`
      DROP INDEX CONCURRENTLY IF EXISTS "public"."IDX_soroban_events_status_created_at"
    `);

    await queryRunner.query(`
      DROP INDEX CONCURRENTLY IF EXISTS "public"."IDX_soroban_events_contract_type_created_at"
    `);
  }
}
