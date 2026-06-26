import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePortfolioMaterializedSnapshots1745700000000 implements MigrationInterface {
  name = 'CreatePortfolioMaterializedSnapshots1745700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "portfolio_materialized_snapshots" (
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
      )
    `);

    // Unique index on userId — one materialized row per user for O(1) lookups
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_materialized_user"
        ON "portfolio_materialized_snapshots" ("userId")
    `);

    // Foreign key to users
    await queryRunner.query(`
      ALTER TABLE "portfolio_materialized_snapshots"
        ADD CONSTRAINT "FK_materialized_user"
        FOREIGN KEY ("userId") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    // Backfill from latest snapshot per user
    await queryRunner.query(`
      INSERT INTO "portfolio_materialized_snapshots"
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
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "portfolio_materialized_snapshots"
        DROP CONSTRAINT "FK_materialized_user"
    `);

    await queryRunner.query(`
      DROP INDEX "public"."UQ_materialized_user"
    `);

    await queryRunner.query(`
      DROP TABLE "portfolio_materialized_snapshots"
    `);
  }
}
