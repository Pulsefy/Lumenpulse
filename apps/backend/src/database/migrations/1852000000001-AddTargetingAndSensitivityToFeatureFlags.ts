import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTargetingAndSensitivityToFeatureFlags1852000000001
  implements MigrationInterface
{
  name = 'AddTargetingAndSensitivityToFeatureFlags1852000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "feature_flags"
      ADD COLUMN IF NOT EXISTS "targetPercentage" integer,
      ADD COLUMN IF NOT EXISTS "sensitive" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "feature_flag_audit_logs"
      ADD COLUMN IF NOT EXISTS "targetPercentage" integer,
      ADD COLUMN IF NOT EXISTS "sensitive" boolean
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "feature_flag_audit_logs"
      DROP COLUMN IF EXISTS "sensitive",
      DROP COLUMN IF EXISTS "targetPercentage"
    `);

    await queryRunner.query(`
      ALTER TABLE "feature_flags"
      DROP COLUMN IF EXISTS "sensitive",
      DROP COLUMN IF EXISTS "targetPercentage"
    `);
  }
}
