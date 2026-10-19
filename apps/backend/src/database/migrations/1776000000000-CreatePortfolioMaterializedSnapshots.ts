import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `portfolio_materialized_snapshots` table.
 *
 * Reconciles the legacy migration that used to live in the untracked
 * `src/migrations` directory. Idempotent guards make it safe to run on both
 * fresh and already-migrated databases, and the backfill is conflict-safe.
 */
export class CreatePortfolioMaterializedSnapshots1776000000000 implements MigrationInterface {
  name = 'CreatePortfolioMaterializedSnapshots1776000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "portfolio_materialized_snapshots" (
        "id"                uuid            NOT NULL DEFAULT uuid_generate_v4(),
        "userId"            uuid            NOT NULL,
        "totalValueUsd"     decimal(18, 2)  NOT NULL,
        "assetBalances"     jsonb           NOT NULL DEFAULT '[]',
        "assetAllocation"   jsonb           DEFAULT NULL,
        "hasLinkedAccount"  boolean         NOT NULL DEFAULT false,
        "source_snapshot_id" uuid           NOT NULL,
        "createdAt"         timestamptz     NOT NULL DEFAULT now(),
        "updatedAt"         timestamptz     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_portfolio_materialized_snapshots" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_materialized_user" ON "portfolio_materialized_snapshots" ("userId")`,
    );

    await queryRunner.query(
      `DO $$ BEGIN ALTER TABLE "portfolio_materialized_snapshots" ADD CONSTRAINT "FK_materialized_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    );

    // Backfill from latest snapshot per user. The unique userId index makes
    // the insert conflict-safe so it can be replayed on existing databases.
    await queryRunner.query(
      `INSERT INTO "portfolio_materialized_snapshots"
        ("userId", "totalValueUsd", "assetBalances", "hasLinkedAccount", "source_snapshot_id", "createdAt", "updatedAt")
      SELECT
        s."userId",
        s."totalValueUsd",
        s."assetBalances",
        CASE WHEN sa."id" IS NOT NULL THEN true ELSE false END AS "hasLinkedAccount",
        s."id" AS "source_snapshot_id",
        now() AS "createdAt",
        now() AS "updatedAt"
      FROM (
        SELECT DISTINCT ON (ps."userId")
          ps."id",
          ps."userId",
          ps."totalValueUsd",
          ps."assetBalances",
          ps."createdAt"
        FROM "portfolio_snapshots" ps
        ORDER BY ps."userId", ps."createdAt" DESC
      ) s
      LEFT JOIN "stellar_accounts" sa ON sa."userId" = s."userId"
      ON CONFLICT ("userId") DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "portfolio_materialized_snapshots" DROP CONSTRAINT IF EXISTS "FK_materialized_user"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_materialized_user"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "portfolio_materialized_snapshots"`,
    );
  }
}
