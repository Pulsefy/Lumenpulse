import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePortfolioSnapshot1769600000000 implements MigrationInterface {
  name = 'CreatePortfolioSnapshot1769600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create portfolio_snapshots table
    await queryRunner.query(
      `CREATE TABLE "portfolio_snapshots" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "assetBalances" jsonb NOT NULL,
        "totalValueUsd" numeric(18,2) NOT NULL,
        CONSTRAINT "PK_portfolio_snapshots" PRIMARY KEY ("id")
      )`,
    );

    // Create index for efficient querying by userId and createdAt
    await queryRunner.query(
      `CREATE INDEX "IDX_portfolio_snapshots_userId_createdAt" ON "portfolio_snapshots" ("userId", "createdAt")`,
    );

    // Add foreign key constraint
    await queryRunner.query(
      `ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "FK_portfolio_snapshots_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "portfolio_snapshots" DROP CONSTRAINT "FK_portfolio_snapshots_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_portfolio_snapshots_userId_createdAt"`,
    );
    await queryRunner.query(`DROP TABLE "portfolio_snapshots"`);
  }
}
