import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBlockchainAuditLogs1801000000000 implements MigrationInterface {
  name = 'CreateBlockchainAuditLogs1801000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "blockchain_audit_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "actor_id" uuid NOT NULL,
        "actor_display" character varying(255) NOT NULL,
        "endpoint" character varying(255) NOT NULL,
        "http_method" character varying(10) NOT NULL,
        "target_contract" character varying(100) NOT NULL,
        "function_name" character varying(100) NOT NULL,
        "contract_address" character varying(255) NOT NULL,
        "params_summary" jsonb,
        "tx_hash" character varying(255) NOT NULL,
        "tx_status" character varying(50) NOT NULL DEFAULT 'success',
        "ledger_seq" bigint,
        "action_description" text,
        "ip_address" character varying(45),
        "error_message" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_blockchain_audit_logs" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_blockchain_audit_logs_actor_id" ON "blockchain_audit_logs" ("actor_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_blockchain_audit_logs_target_contract" ON "blockchain_audit_logs" ("target_contract")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_blockchain_audit_logs_tx_hash" ON "blockchain_audit_logs" ("tx_hash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_blockchain_audit_logs_createdAt" ON "blockchain_audit_logs" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_blockchain_audit_logs_createdAt"`);
    await queryRunner.query(`DROP INDEX "IDX_blockchain_audit_logs_tx_hash"`);
    await queryRunner.query(`DROP INDEX "IDX_blockchain_audit_logs_target_contract"`);
    await queryRunner.query(`DROP INDEX "IDX_blockchain_audit_logs_actor_id"`);
    await queryRunner.query(`DROP TABLE "blockchain_audit_logs"`);
  }
}
