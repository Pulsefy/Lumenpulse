import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `contract_health_snapshots` table which stores one row per
 * periodic or manual capture of the ContractHealthService report.
 *
 * Down migration drops the table cleanly.
 */
export class CreateContractHealthSnapshots1780000000000 implements MigrationInterface {
  name = 'CreateContractHealthSnapshots1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "contract_health_snapshots" (
        "id"             uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "captured_at"    timestamptz   NOT NULL,
        "network"        varchar(20)   NOT NULL,
        "overall_status" varchar(20)   NOT NULL,
        "summary"        jsonb         NOT NULL,
        "contracts"      jsonb         NOT NULL,
        "triggered_by"   varchar(50)   NOT NULL DEFAULT 'scheduler',
        "created_at"     timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_contract_health_snapshots" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_chs_captured_at"
        ON "contract_health_snapshots" ("captured_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_chs_network"
        ON "contract_health_snapshots" ("network")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_chs_network"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_chs_captured_at"`);
    await queryRunner.query(`DROP TABLE "contract_health_snapshots"`);
  }
}
