import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCrowdfundVaultTables1830000000000 implements MigrationInterface {
  name = 'CreateCrowdfundVaultTables1830000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create crowdfund_vault_projects table
    await queryRunner.query(`
      CREATE TABLE "crowdfund_vault_projects" (
        "vault_address" character varying(56) NOT NULL,
        "project_id" character varying NOT NULL,
        "contract_address" character varying(56),
        "token_address" character varying(56),
        "owner_address" character varying(56),
        "is_active" boolean NOT NULL DEFAULT true,
        "metadata_uri" character varying,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "last_synced_at" TIMESTAMP,
        CONSTRAINT "PK_crowdfund_vault_projects" PRIMARY KEY ("vault_address")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_crowdfund_vault_projects_project_id" 
      ON "crowdfund_vault_projects" ("project_id");
    `);

    // Create crowdfund_vault_cursors table
    await queryRunner.query(`
      CREATE TABLE "crowdfund_vault_cursors" (
        "vault_address" character varying(56) NOT NULL,
        "last_ledger_sequence" bigint NOT NULL DEFAULT 0,
        "last_ledger_hash" character varying(64),
        "last_processed_tx_hash" character varying(64),
        "last_synced_at" TIMESTAMP,
        "consecutive_failures" integer NOT NULL DEFAULT 0,
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "safe_ledger_sequence" bigint NOT NULL DEFAULT 0,
        CONSTRAINT "PK_crowdfund_vault_cursors" PRIMARY KEY ("vault_address")
      );
    `);

    // Create crowdfund_vault_events table
    await queryRunner.query(`
      CREATE TYPE "crowdfund_vault_events_event_type_enum" AS ENUM (
        'contribution', 'milestone_approved', 'funds_withdrawn', 
        'vault_created', 'refund_initiated', 'refund_completed'
      );

      CREATE TYPE "crowdfund_vault_events_status_enum" AS ENUM (
        'pending', 'processed', 'failed', 'skipped'
      );

      CREATE TABLE "crowdfund_vault_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "transaction_hash" character varying(64) NOT NULL,
        "event_index" integer NOT NULL,
        "vault_address" character varying(56) NOT NULL,
        "project_id" character varying,
        "event_type" "crowdfund_vault_events_event_type_enum" NOT NULL,
        "ledger_sequence" bigint NOT NULL,
        "ledger_closed_at" TIMESTAMP NOT NULL,
        "raw_payload" jsonb NOT NULL,
        "normalized_data" jsonb,
        "status" "crowdfund_vault_events_status_enum" NOT NULL DEFAULT 'pending',
        "processing_attempts" integer NOT NULL DEFAULT 0,
        "last_error_message" text,
        "last_error_stack" text,
        "processed_at" TIMESTAMP,
        "skipped_reason" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "is_reorg_candidate" boolean NOT NULL DEFAULT false,
        "contract_ledger_sequence" bigint,
        CONSTRAINT "UQ_crowdfund_vault_events_tx_hash_event_index" 
        UNIQUE ("transaction_hash", "event_index"),
        CONSTRAINT "PK_crowdfund_vault_events" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_crowdfund_vault_events_vault_address" 
      ON "crowdfund_vault_events" ("vault_address");

      CREATE INDEX "IDX_crowdfund_vault_events_vault_ledger" 
      ON "crowdfund_vault_events" ("vault_address", "ledger_sequence");

      CREATE INDEX "IDX_crowdfund_vault_events_event_type_status" 
      ON "crowdfund_vault_events" ("event_type", "status");

      CREATE INDEX "IDX_crowdfund_vault_events_processed_at" 
      ON "crowdfund_vault_events" ("processed_at");

      CREATE INDEX "IDX_crowdfund_vault_events_project_id" 
      ON "crowdfund_vault_events" ("project_id");
    `);

    // Create crowdfund_vault_dead_letter table
    await queryRunner.query(`
      CREATE TYPE "crowdfund_vault_dead_letter_status_enum" AS ENUM (
        'pending', 'replayed', 'resolved'
      );

      CREATE TABLE "crowdfund_vault_dead_letter" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "event_id" uuid,
        "transaction_hash" character varying(64) NOT NULL,
        "event_index" integer NOT NULL,
        "vault_address" character varying(56) NOT NULL,
        "event_type" character varying NOT NULL,
        "ledger_sequence" bigint NOT NULL,
        "raw_payload" jsonb NOT NULL,
        "failure_count" integer NOT NULL DEFAULT 1,
        "last_error_message" text NOT NULL,
        "last_error_stack" text,
        "error_history" jsonb NOT NULL DEFAULT '[]',
        "status" "crowdfund_vault_dead_letter_status_enum" NOT NULL DEFAULT 'pending',
        "maintainer_notes" text,
        "replay_count" integer NOT NULL DEFAULT 0,
        "last_replayed_at" TIMESTAMP,
        "resolved_at" TIMESTAMP,
        "resolved_by" character varying,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_crowdfund_vault_dead_letter" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_crowdfund_vault_dead_letter_status_created" 
      ON "crowdfund_vault_dead_letter" ("status", "created_at");

      CREATE INDEX "IDX_crowdfund_vault_dead_letter_vault_address" 
      ON "crowdfund_vault_dead_letter" ("vault_address");

      CREATE INDEX "IDX_crowdfund_vault_dead_letter_vault_event_type" 
      ON "crowdfund_vault_dead_letter" ("vault_address", "event_type");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "crowdfund_vault_dead_letter"`);
    await queryRunner.query(
      `DROP TYPE "crowdfund_vault_dead_letter_status_enum"`,
    );
    await queryRunner.query(`DROP TABLE "crowdfund_vault_events"`);
    await queryRunner.query(`DROP TYPE "crowdfund_vault_events_status_enum"`);
    await queryRunner.query(
      `DROP TYPE "crowdfund_vault_events_event_type_enum"`,
    );
    await queryRunner.query(`DROP TABLE "crowdfund_vault_cursors"`);
    await queryRunner.query(`DROP TABLE "crowdfund_vault_projects"`);
  }
}
