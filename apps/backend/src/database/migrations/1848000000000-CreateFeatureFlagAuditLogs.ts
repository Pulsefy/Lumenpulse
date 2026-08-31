import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFeatureFlagAuditLogs1848000000000
  implements MigrationInterface
{
  name = 'CreateFeatureFlagAuditLogs1848000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "feature_flag_audit_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "flagKey" character varying(200) NOT NULL,
        "action" character varying(20) NOT NULL,
        "previousEnabled" boolean,
        "newEnabled" boolean,
        "actor" character varying(200),
        "changedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_feature_flag_audit_logs_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_feature_flag_audit_logs_flagKey" ON "feature_flag_audit_logs" ("flagKey")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_feature_flag_audit_logs_actor" ON "feature_flag_audit_logs" ("actor")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_feature_flag_audit_logs_changedAt" ON "feature_flag_audit_logs" ("changedAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_feature_flag_audit_logs_changedAt"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_feature_flag_audit_logs_actor"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_feature_flag_audit_logs_flagKey"`,
    );
    await queryRunner.query(`DROP TABLE "feature_flag_audit_logs"`);
  }
}
