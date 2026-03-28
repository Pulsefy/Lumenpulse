import { MigrationInterface, QueryRunner } from 'typeorm';

export class DatabasePerformanceIndexes1769800000000 implements MigrationInterface {
  name = 'DatabasePerformanceIndexes1769800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // PortfolioAsset Indexes
    await queryRunner.query(
      `CREATE INDEX "IDX_portfolio_assets_userId_assetCode" ON "portfolio_assets" ("userId", "assetCode")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_portfolio_assets_userId" ON "portfolio_assets" ("userId")`,
    );

    // NewsArticle (articles table) Indexes
    await queryRunner.query(
      `CREATE INDEX "IDX_articles_publishedAt" ON "articles" ("publishedAt")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_articles_source" ON "articles" ("source")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_articles_sentimentScore" ON "articles" ("sentimentScore")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_articles_source_publishedAt" ON "articles" ("source", "publishedAt")`,
    );

    // User (users table) Indexes
    await queryRunner.query(`CREATE INDEX "IDX_users_role" ON "users" ("role")`);
    await queryRunner.query(`CREATE INDEX "IDX_users_createdAt" ON "users" ("createdAt")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop User Indexes
    await queryRunner.query(`DROP INDEX "IDX_users_createdAt"`);
    await queryRunner.query(`DROP INDEX "IDX_users_role"`);

    // Drop NewsArticle Indexes
    await queryRunner.query(`DROP INDEX "IDX_articles_source_publishedAt"`);
    await queryRunner.query(`DROP INDEX "IDX_articles_sentimentScore"`);
    await queryRunner.query(`DROP INDEX "IDX_articles_source"`);
    await queryRunner.query(`DROP INDEX "IDX_articles_publishedAt"`);

    // Drop PortfolioAsset Indexes
    await queryRunner.query(`DROP INDEX "IDX_portfolio_assets_userId"`);
    await queryRunner.query(`DROP INDEX "IDX_portfolio_assets_userId_assetCode"`);
  }
}
