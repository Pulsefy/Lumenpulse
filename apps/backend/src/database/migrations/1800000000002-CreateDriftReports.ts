import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDriftReports1800000000002 implements MigrationInterface {
  name = 'CreateDriftReports1800000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tableExists = await queryRunner.hasTable('drift_reports');
    if (tableExists) return;

    await queryRunner.query(`
      CREATE TYPE "drift_reports_status_enum" AS ENUM ('running', 'completed', 'failed')
    `);

    await queryRunner.query(`
      CREATE TABLE "drift_reports" (
        "id"              uuid NOT NULL DEFAULT uuid_generate_v4(),
        "triggeredBy"     character varying(50) NOT NULL DEFAULT 'scheduled',
        "status"          "drift_reports_status_enum" NOT NULL DEFAULT 'running',
        "totalScanned"    integer NOT NULL DEFAULT 0,
        "totalDrifts"     integer NOT NULL DEFAULT 0,
        "criticalCount"   integer NOT NULL DEFAULT 0,
        "highCount"       integer NOT NULL DEFAULT 0,
        "mediumCount"     integer NOT NULL DEFAULT 0,
        "lowCount"        integer NOT NULL DEFAULT 0,
        "drifts"          jsonb DEFAULT NULL,
        "summary"         jsonb DEFAULT NULL,
        "errorMessage"    text DEFAULT NULL,
        "startedAt"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "finishedAt"      TIMESTAMP WITH TIME ZONE DEFAULT NULL,
        "durationMs"      integer DEFAULT NULL,
        CONSTRAINT "PK_drift_reports" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_drift_reports_status" ON "drift_reports" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_drift_reports_startedAt" ON "drift_reports" ("startedAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_drift_reports_triggeredBy" ON "drift_reports" ("triggeredBy")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tableExists = await queryRunner.hasTable('drift_reports');
    if (!tableExists) return;

    await queryRunner.query(`DROP INDEX "public"."IDX_drift_reports_triggeredBy"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_drift_reports_startedAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_drift_reports_status"`);
    await queryRunner.query(`DROP TABLE "drift_reports"`);
    await queryRunner.query(`DROP TYPE "drift_reports_status_enum"`);
  }
}
