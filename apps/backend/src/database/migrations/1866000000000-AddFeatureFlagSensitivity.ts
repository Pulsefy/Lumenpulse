import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `sensitive` marker to feature flags.
 *
 * A sensitive flag can only be changed or deleted when the request carries an
 * explicit confirmation, which the admin console collects through a
 * type-the-key dialog. The column is NOT NULL with a false default so every
 * existing flag reads as non-sensitive without a data backfill.
 *
 * On PostgreSQL 11+ adding a column with a constant DEFAULT is a catalog-only
 * change (no table rewrite), so the NOT NULL + DEFAULT warning from
 * `migration:check` does not apply. Splitting this into a nullable add plus
 * `SET NOT NULL` would be worse: that step scans the whole table under lock.
 */
export class AddFeatureFlagSensitivity1866000000000 implements MigrationInterface {
  name = 'AddFeatureFlagSensitivity1866000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "feature_flags"
      ADD COLUMN "sensitive" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "feature_flags"
      DROP COLUMN "sensitive"
    `);
  }
}
