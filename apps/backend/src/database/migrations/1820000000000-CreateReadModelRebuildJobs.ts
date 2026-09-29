import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `read_model_rebuild_jobs` table.
 *
 * Column names are aligned with the `ReadModelRebuildJob` entity (camelCase)
 * so the schema produced by the migration set matches the entity definitions
 * used by the application.
 */
export class CreateReadModelRebuildJobs1820000000000 implements MigrationInterface {
  name = 'CreateReadModelRebuildJobs1820000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "read_model_rebuild_jobs_dataset_enum" AS ENUM ('kpi_snapshots', 'project_views', 'contract_events', 'daily_metrics', 'all')`,
    );
    await queryRunner.query(
      `CREATE TYPE "read_model_rebuild_jobs_status_enum" AS ENUM ('pending', 'in_progress', 'completed', 'failed', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TABLE "read_model_rebuild_jobs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "dataset" "read_model_rebuild_jobs_dataset_enum" NOT NULL, "contractId" character varying(255), "status" "read_model_rebuild_jobs_status_enum" NOT NULL DEFAULT 'pending', "triggerReason" text, "triggeredBy" character varying(255), "totalItems" integer NOT NULL DEFAULT 0, "processedItems" integer NOT NULL DEFAULT 0, "failedItems" integer NOT NULL DEFAULT 0, "progressDetails" jsonb, "errorMessage" text, "errorStack" jsonb, "startedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, "idempotencyKey" character varying(255), "rebuildVersion" character varying(50), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_read_model_rebuild_jobs" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_rebuild_jobs_status_created" ON "read_model_rebuild_jobs" ("status", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_rebuild_jobs_dataset_status" ON "read_model_rebuild_jobs" ("dataset", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_rebuild_jobs_contract_status" ON "read_model_rebuild_jobs" ("contractId", "status")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_rebuild_jobs_idempotency_key" ON "read_model_rebuild_jobs" ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_rebuild_jobs_idempotency_key"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_rebuild_jobs_contract_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_rebuild_jobs_dataset_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_rebuild_jobs_status_created"`,
    );
    await queryRunner.query(`DROP TABLE "read_model_rebuild_jobs"`);
    await queryRunner.query(`DROP TYPE "read_model_rebuild_jobs_status_enum"`);
    await queryRunner.query(`DROP TYPE "read_model_rebuild_jobs_dataset_enum"`);
  }
}
