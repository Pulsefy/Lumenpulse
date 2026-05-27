import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateJobRuns1772000000000 implements MigrationInterface {
  name = 'CreateJobRuns1772000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "job_runs_status_enum" AS ENUM ('running', 'completed', 'failed', 'skipped')`,
    );

    await queryRunner.query(`
      CREATE TABLE "job_runs" (
        "id"          uuid                          NOT NULL DEFAULT uuid_generate_v4(),
        "jobName"     character varying(100)        NOT NULL,
        "status"      "job_runs_status_enum"        NOT NULL DEFAULT 'running',
        "triggeredBy" character varying(50)         NOT NULL DEFAULT 'scheduled',
        "result"      jsonb,
        "errorMessage" text,
        "startedAt"   TIMESTAMP WITH TIME ZONE      NOT NULL DEFAULT now(),
        "finishedAt"  TIMESTAMP WITH TIME ZONE,
        "durationMs"  integer,
        CONSTRAINT "PK_job_runs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_job_runs_name_started" ON "job_runs" ("jobName", "startedAt" DESC)`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_job_runs_status" ON "job_runs" ("status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_job_runs_status"`);
    await queryRunner.query(`DROP INDEX "IDX_job_runs_name_started"`);
    await queryRunner.query(`DROP TABLE "job_runs"`);
    await queryRunner.query(`DROP TYPE "job_runs_status_enum"`);
  }
}
