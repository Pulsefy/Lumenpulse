import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChangedByToFeatureFlags1790000000002
  implements MigrationInterface
{
  name = 'AddChangedByToFeatureFlags1790000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "feature_flags"
      ADD COLUMN "changedBy" character varying(100)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "feature_flags"
      DROP COLUMN "changedBy"
    `);
  }
}
