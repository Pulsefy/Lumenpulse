import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDriftSuppressions1800000000003 implements MigrationInterface {
  name = 'CreateDriftSuppressions1800000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tableExists = await queryRunner.hasTable('drift_suppressions');
    if (tableExists) return;

    await queryRunner.query(`
      CREATE TABLE "drift_suppressions" (
        "id"            uuid NOT NULL DEFAULT uuid_generate_v4(),
        "entityType"    character varying(100) NOT NULL,
        "entityId"      character varying(100) NOT NULL,
        "field"         character varying(100) NOT NULL,
        "reason"        text DEFAULT NULL,
        "suppressedBy"  character varying(255) DEFAULT NULL,
        "createdAt"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "expiresAt"     TIMESTAMP WITH TIME ZONE DEFAULT NULL,
        CONSTRAINT "PK_drift_suppressions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_drift_suppressions_entity" ON "drift_suppressions" ("entityType", "entityId", "field")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_drift_suppressions_expires" ON "drift_suppressions" ("expiresAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tableExists = await queryRunner.hasTable('drift_suppressions');
    if (!tableExists) return;

    await queryRunner.query(`DROP INDEX "public"."IDX_drift_suppressions_expires"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_drift_suppressions_entity"`);
    await queryRunner.query(`DROP TABLE "drift_suppressions"`);
  }
}
