import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVaultEventTables1780000000000 implements MigrationInterface {
  name = 'CreateVaultEventTables1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const depositsExists = await queryRunner.hasTable('vault_deposit_events');
    if (!depositsExists) {
      await queryRunner.query(`
        CREATE TABLE "vault_deposit_events" (
          "id"           uuid NOT NULL DEFAULT uuid_generate_v4(),
          "event_id"     character varying NOT NULL,
          "contract_id"  character varying NOT NULL,
          "ledger"       integer NOT NULL,
          "ledger_at"    TIMESTAMP WITH TIME ZONE NOT NULL,
          "user_address" character varying NOT NULL,
          "project_id"   bigint NOT NULL,
          "amount"       numeric(38,0) NOT NULL,
          "created_at"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          CONSTRAINT "PK_vault_deposit_events" PRIMARY KEY ("id"),
          CONSTRAINT "UQ_vault_deposit_events_event_id" UNIQUE ("event_id")
        )
      `);
      await queryRunner.query(
        `CREATE INDEX "IDX_vault_deposit_events_project_id" ON "vault_deposit_events" ("project_id")`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_vault_deposit_events_ledger" ON "vault_deposit_events" ("ledger")`,
      );
    }

    const milestonesExists = await queryRunner.hasTable(
      'vault_milestone_events',
    );
    if (!milestonesExists) {
      await queryRunner.query(`
        CREATE TABLE "vault_milestone_events" (
          "id"           uuid NOT NULL DEFAULT uuid_generate_v4(),
          "event_id"     character varying NOT NULL,
          "contract_id"  character varying NOT NULL,
          "ledger"       integer NOT NULL,
          "ledger_at"    TIMESTAMP WITH TIME ZONE NOT NULL,
          "project_id"   bigint NOT NULL,
          "milestone_id" integer NOT NULL,
          "approved_by"  character varying,
          "via_vote"     boolean NOT NULL DEFAULT false,
          "created_at"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          CONSTRAINT "PK_vault_milestone_events" PRIMARY KEY ("id"),
          CONSTRAINT "UQ_vault_milestone_events_event_id" UNIQUE ("event_id")
        )
      `);
      await queryRunner.query(
        `CREATE INDEX "IDX_vault_milestone_events_project_id" ON "vault_milestone_events" ("project_id")`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_vault_milestone_events_ledger" ON "vault_milestone_events" ("ledger")`,
      );
    }

    // Cursor table for the vault indexer
    const cursorExists = await queryRunner.hasTable(
      'vault_indexer_cursors',
    );
    if (!cursorExists) {
      await queryRunner.query(`
        CREATE TABLE "vault_indexer_cursors" (
          "id"          uuid NOT NULL DEFAULT uuid_generate_v4(),
          "contract_id" character varying NOT NULL,
          "cursor"      character varying NOT NULL,
          "updated_at"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          CONSTRAINT "PK_vault_indexer_cursors" PRIMARY KEY ("id"),
          CONSTRAINT "UQ_vault_indexer_cursors_contract_id" UNIQUE ("contract_id")
        )
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_vault_milestone_events_ledger"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_vault_milestone_events_project_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "vault_milestone_events"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_vault_deposit_events_ledger"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_vault_deposit_events_project_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "vault_deposit_events"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "vault_indexer_cursors"`);
  }
}
