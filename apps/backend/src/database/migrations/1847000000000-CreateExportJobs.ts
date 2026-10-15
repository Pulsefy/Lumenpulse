import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `export_jobs` table. The `ExportJob` entity had no
 * corresponding migration, so the table was never created by a tracked
 * migration and the schema-drift check in CI flagged it as missing.
 */
export class CreateExportJobs1847000000000 implements MigrationInterface {
  name = 'CreateExportJobs1847000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "export_jobs_type_enum" AS ENUM ('portfolio_history', 'tax_transactions', 'onchain_analytics', 'round_analytics')`,
    );
    await queryRunner.query(
      `CREATE TYPE "export_jobs_status_enum" AS ENUM ('pending', 'processing', 'completed', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "export_jobs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "type" "export_jobs_type_enum" NOT NULL, "status" "export_jobs_status_enum" NOT NULL DEFAULT 'pending', "csvData" text, "errorMessage" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_export_jobs" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_export_jobs_user_created" ON "export_jobs" ("userId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_export_jobs_status" ON "export_jobs" ("status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "export_jobs"`);
    await queryRunner.query(`DROP TYPE "export_jobs_status_enum"`);
    await queryRunner.query(`DROP TYPE "export_jobs_type_enum"`);
  }
}
