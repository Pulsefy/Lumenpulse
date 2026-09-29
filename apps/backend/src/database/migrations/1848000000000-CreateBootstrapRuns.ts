import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `bootstrap_runs` table backing the testnet bootstrap teardown
 * path. Each row records one bootstrap run (demo seed or Friendbot funding),
 * the resources it created, and — once torn down — the per-resource outcome.
 */
export class CreateBootstrapRuns1848000000000 implements MigrationInterface {
  name = 'CreateBootstrapRuns1848000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "bootstrap_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "kind" character varying(32) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'active',
        "network" character varying(20) NOT NULL,
        "environment" character varying(32) NOT NULL,
        "resources" jsonb NOT NULL,
        "created_by" character varying(64),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "torn_down_at" TIMESTAMP WITH TIME ZONE,
        "torn_down_by" character varying(64),
        "teardown_summary" jsonb,
        CONSTRAINT "PK_bootstrap_runs" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bootstrap_runs_created_at" ON "bootstrap_runs" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_bootstrap_runs_kind_status" ON "bootstrap_runs" ("kind", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_bootstrap_runs_kind_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_bootstrap_runs_created_at"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "bootstrap_runs"`);
  }
}
