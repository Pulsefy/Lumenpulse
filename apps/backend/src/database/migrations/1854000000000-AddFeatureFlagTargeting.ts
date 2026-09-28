import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds percentage targeting to feature flags.
 *
 * `rolloutPercentage` fully determines the evaluation result when it is above
 * zero, so the shared allow/deny lists hold the principals that bypass it.
 * Both are jsonb because the lists are ids that may contain any character
 * (a comma-separated text column would corrupt them), and both are nullable so
 * an existing row reads as "no targeting configured" — plain on/off — without
 * a data backfill.
 *
 * The audit log gains before/after targeting snapshots so a change to who a
 * flag targets is as reviewable as a change to whether it is on.
 */
export class AddFeatureFlagTargeting1854000000000 implements MigrationInterface {
  name = 'AddFeatureFlagTargeting1854000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "feature_flags"
      ADD COLUMN "rolloutPercentage" integer
    `);
    await queryRunner.query(`
      ALTER TABLE "feature_flags"
      ADD COLUMN "allowList" jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "feature_flags"
      ADD COLUMN "denyList" jsonb
    `);
    // Defends the column against values the DTO validator already rejects, so a
    // direct SQL write cannot create a >100% rollout or a negative one.
    await queryRunner.query(`
      ALTER TABLE "feature_flags"
      ADD CONSTRAINT "CHK_feature_flags_rolloutPercentage"
      CHECK ("rolloutPercentage" IS NULL OR "rolloutPercentage" BETWEEN 0 AND 100)
    `);
    // Both lists are principal id arrays; anything else is a write bug that
    // would otherwise surface as an evaluation failure at request time.
    await queryRunner.query(`
      ALTER TABLE "feature_flags"
      ADD CONSTRAINT "CHK_feature_flags_allowList"
      CHECK ("allowList" IS NULL OR jsonb_typeof("allowList") = 'array')
    `);
    await queryRunner.query(`
      ALTER TABLE "feature_flags"
      ADD CONSTRAINT "CHK_feature_flags_denyList"
      CHECK ("denyList" IS NULL OR jsonb_typeof("denyList") = 'array')
    `);

    await queryRunner.query(`
      ALTER TABLE "feature_flag_audit_logs"
      ADD COLUMN "previousTargeting" jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "feature_flag_audit_logs"
      ADD COLUMN "newTargeting" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "feature_flag_audit_logs"
      DROP COLUMN "newTargeting"
    `);
    await queryRunner.query(`
      ALTER TABLE "feature_flag_audit_logs"
      DROP COLUMN "previousTargeting"
    `);
    await queryRunner.query(
      `ALTER TABLE "feature_flags" DROP CONSTRAINT "CHK_feature_flags_denyList"`,
    );
    await queryRunner.query(
      `ALTER TABLE "feature_flags" DROP CONSTRAINT "CHK_feature_flags_allowList"`,
    );
    await queryRunner.query(
      `ALTER TABLE "feature_flags" DROP CONSTRAINT "CHK_feature_flags_rolloutPercentage"`,
    );
    await queryRunner.query(`
      ALTER TABLE "feature_flags"
      DROP COLUMN "denyList"
    `);
    await queryRunner.query(`
      ALTER TABLE "feature_flags"
      DROP COLUMN "allowList"
    `);
    await queryRunner.query(`
      ALTER TABLE "feature_flags"
      DROP COLUMN "rolloutPercentage"
    `);
  }
}
