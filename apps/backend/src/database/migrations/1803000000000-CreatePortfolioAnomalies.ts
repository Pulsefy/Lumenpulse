import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePortfolioAnomalies1803000000000 implements MigrationInterface {
  name = 'CreatePortfolioAnomalies1803000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE portfolio_anomalies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" UUID NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        anomaly_type VARCHAR(100) NOT NULL,
        severity VARCHAR(20) NOT NULL DEFAULT 'medium',
        status VARCHAR(20) NOT NULL DEFAULT 'unresolved',
        "reviewerId" UUID,
        "reviewerNotes" TEXT,
        "reviewedAt" TIMESTAMPTZ,
        "reviewerNotesUpdatedAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        version INTEGER NOT NULL DEFAULT 1
      );

      CREATE INDEX idx_portfolio_anomalies_user_created_at
        ON portfolio_anomalies ("userId", "createdAt" DESC);

      CREATE INDEX idx_portfolio_anomalies_status
        ON portfolio_anomalies (status);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS portfolio_anomalies;
    `);
  }
}
