import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `contract_deployment_manifests` table. The
 * `ContractDeploymentManifest` entity had no corresponding migration, so the
 * table was never created by a tracked migration and the schema-drift check
 * in CI flagged it as missing.
 */
export class CreateContractDeploymentManifests1844000000000 implements MigrationInterface {
  name = 'CreateContractDeploymentManifests1844000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "contract_deployment_manifests" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "environment" character varying(50) NOT NULL DEFAULT 'testnet', "version" character varying(100), "contracts" jsonb NOT NULL, "metadata" jsonb, "isActive" boolean NOT NULL DEFAULT false, "createdBy" character varying(255), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_contract_deployment_manifests" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_contract_deployment_manifests_environment" ON "contract_deployment_manifests" ("environment")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_contract_deployment_manifests_isActive" ON "contract_deployment_manifests" ("isActive")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_contract_deployment_manifests_createdAt" ON "contract_deployment_manifests" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "contract_deployment_manifests"`);
  }
}
