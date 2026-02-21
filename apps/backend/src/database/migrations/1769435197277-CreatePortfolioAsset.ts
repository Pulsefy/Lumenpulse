import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePortfolioAsset1769435197277 implements MigrationInterface {
  name = 'CreatePortfolioAsset1769435197277';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "portfolio_assets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "assetCode" character varying NOT NULL, "assetIssuer" character varying, "amount" numeric(18,8) NOT NULL, CONSTRAINT "PK_650ad7e532b1ada99c316eee7be" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolio_assets" ADD CONSTRAINT "FK_d4f98a41174caf9217c1498f387" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "portfolio_assets" DROP CONSTRAINT "FK_d4f98a41174caf9217c1498f387"`,
    );
    await queryRunner.query(`DROP TABLE "portfolio_assets"`);
  }
}
