import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFeatureFlags1779999999999 implements MigrationInterface {
  name = 'CreateFeatureFlags1779999999999';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "feature_flags" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "key" character varying(200) NOT NULL,
        "enabled" boolean NOT NULL DEFAULT false,
        "conditions" jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_feature_flags_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_feature_flags_key" ON "feature_flags" ("key")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_feature_flags_key"`);
    await queryRunner.query(`DROP TABLE "feature_flags"`);
  }
}
