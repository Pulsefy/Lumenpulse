import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReconciliationJobs1769910000000 implements MigrationInterface {
  name = 'CreateReconciliationJobs1769910000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tableExists = await queryRunner.hasTable('reconciliation_jobs');
    if (tableExists) return;

    await queryRunner.query(`
      CREATE TYPE "reconciliation_status_enum" AS ENUM ('running', 'completed', 'failed')
    `);

    await queryRunner.query(`
      CREATE TABLE "reconciliation_jobs" (
        "id"              uuid NOT NULL DEFAULT uuid_generate_v4(),
        "status"          "reconciliation_status_enum" NOT NULL DEFAULT 'running',
        "usersProcessed"  integer NOT NULL DEFAULT 0,
        "driftsDetected"  integer NOT NULL DEFAULT 0,
        "driftsRepaired"  integer NOT NULL DEFAULT 0,
        "driftDetails"    jsonb DEFAULT NULL,
        "errorMessage"    text DEFAULT NULL,
        "triggeredBy"     character varying(50) NOT NULL DEFAULT 'scheduled',
        "startedAt"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "finishedAt"      TIMESTAMP WITH TIME ZONE DEFAULT NULL,
        CONSTRAINT "PK_reconciliation_jobs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_reconciliation_jobs_status" ON "reconciliation_jobs" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_reconciliation_jobs_startedAt" ON "reconciliation_jobs" ("startedAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tableExists = await queryRunner.hasTable('reconciliation_jobs');
    if (!tableExists) return;

    await queryRunner.query(
      `DROP INDEX "public"."IDX_reconciliation_jobs_startedAt"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_reconciliation_jobs_status"`,
    );
    await queryRunner.query(`DROP TABLE "reconciliation_jobs"`);
    await queryRunner.query(`DROP TYPE "reconciliation_status_enum"`);
  }
}
