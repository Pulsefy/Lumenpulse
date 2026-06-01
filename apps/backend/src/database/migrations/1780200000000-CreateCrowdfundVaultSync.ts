import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCrowdfundVaultSync1780200000000 implements MigrationInterface {
  name = 'CreateCrowdfundVaultSync1780200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "crowdfund_vault_sync_checkpoints" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "contractId" character varying NOT NULL,
        "lastLedger" bigint NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_crowdfund_vault_sync_checkpoints_contractId" UNIQUE ("contractId"),
        CONSTRAINT "PK_crowdfund_vault_sync_checkpoints" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "crowdfund_vault_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "contractId" character varying NOT NULL,
        "txHash" character varying NOT NULL,
        "eventIndex" integer NOT NULL,
        "eventType" character varying NOT NULL,
        "ledgerSeq" bigint NOT NULL,
        "projectId" bigint,
        "contributor" character varying,
        "amount" character varying,
        "milestoneId" integer,
        "rawPayload" jsonb NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_crowdfund_vault_events_tx_event" UNIQUE ("txHash", "eventIndex"),
        CONSTRAINT "PK_crowdfund_vault_events" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_crowdfund_vault_events_contract_ledger" ON "crowdfund_vault_events" ("contractId", "ledgerSeq")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_crowdfund_vault_events_project_type" ON "crowdfund_vault_events" ("projectId", "eventType")`,
    );

    await queryRunner.query(`
      CREATE TABLE "crowdfund_vault_projects" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "projectId" bigint NOT NULL,
        "contractId" character varying NOT NULL,
        "owner" character varying NOT NULL,
        "tokenAddress" character varying,
        "totalContributions" character varying NOT NULL DEFAULT '0',
        "totalWithdrawn" character varying NOT NULL DEFAULT '0',
        "uniqueContributors" integer NOT NULL DEFAULT 0,
        "status" character varying NOT NULL DEFAULT 'active',
        "refundWindowDeadline" bigint,
        "lastLedgerSeq" bigint NOT NULL DEFAULT 0,
        "lastTxHash" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_crowdfund_vault_projects_projectId" UNIQUE ("projectId"),
        CONSTRAINT "PK_crowdfund_vault_projects" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_crowdfund_vault_projects_status" ON "crowdfund_vault_projects" ("status")`,
    );

    await queryRunner.query(`
      CREATE TABLE "crowdfund_vault_contributors" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "projectId" bigint NOT NULL,
        "contributor" character varying NOT NULL,
        "totalContributed" character varying NOT NULL DEFAULT '0',
        "firstContributionLedger" bigint,
        "lastContributionLedger" bigint,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_crowdfund_vault_contributors_project_contributor" UNIQUE ("projectId", "contributor"),
        CONSTRAINT "PK_crowdfund_vault_contributors" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_crowdfund_vault_contributors_projectId" ON "crowdfund_vault_contributors" ("projectId")`,
    );

    await queryRunner.query(`
      CREATE TABLE "crowdfund_vault_milestones" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "projectId" bigint NOT NULL,
        "milestoneId" integer NOT NULL,
        "status" character varying NOT NULL DEFAULT 'pending',
        "approvedAt" TIMESTAMP,
        "lastLedgerSeq" bigint,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_crowdfund_vault_milestones_project_milestone" UNIQUE ("projectId", "milestoneId"),
        CONSTRAINT "PK_crowdfund_vault_milestones" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_crowdfund_vault_milestones_projectId" ON "crowdfund_vault_milestones" ("projectId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "crowdfund_vault_milestones"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "crowdfund_vault_contributors"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "crowdfund_vault_projects"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "crowdfund_vault_events"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "crowdfund_vault_sync_checkpoints"`,
    );
  }
}
