import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `treasury_beneficiary_history` table. The
 * `TreasuryBeneficiaryHistory` entity had no corresponding migration, so the
 * table was never created by a tracked migration and the schema-drift check
 * in CI flagged it as missing.
 */
export class CreateTreasuryBeneficiaryHistory1845000000000 implements MigrationInterface {
  name = 'CreateTreasuryBeneficiaryHistory1845000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "treasury_beneficiary_history" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "beneficiary" character varying(255) NOT NULL, "previousBeneficiary" character varying(255), "action" character varying(50) NOT NULL, "amount" character varying(255), "txHash" character varying(255), "actorId" character varying(255), "actorEmail" character varying(255), "metadata" jsonb, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_treasury_beneficiary_history" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_treasury_beneficiary_history_beneficiary" ON "treasury_beneficiary_history" ("beneficiary")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_treasury_beneficiary_history_previous" ON "treasury_beneficiary_history" ("previousBeneficiary")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_treasury_beneficiary_history_createdAt" ON "treasury_beneficiary_history" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "treasury_beneficiary_history"`);
  }
}
