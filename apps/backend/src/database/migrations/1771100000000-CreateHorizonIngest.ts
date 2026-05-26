import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateHorizonIngest1771100000000 implements MigrationInterface {
  name = 'CreateHorizonIngest1771100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create horizon_account_operations table
    await queryRunner.query(
      `CREATE TABLE "horizon_account_operations" (
        "id"            uuid                     NOT NULL DEFAULT uuid_generate_v4(),
        "operationId"   character varying(64)    NOT NULL,
        "accountId"     character varying(64)    NOT NULL,
        "type"          character varying(64)    NOT NULL,
        "pagingToken"   character varying(64)    NOT NULL,
        "createdAt"     TIMESTAMP WITH TIME ZONE NOT NULL,
        "raw"           jsonb                    NOT NULL,
        "ingestedAt"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_horizon_account_operations" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_horizon_account_operations_operationId" UNIQUE ("operationId")
      )`,
    );

    // Create indexes for horizon_account_operations
    await queryRunner.query(
      `CREATE INDEX "IDX_horizon_ops_account_created" ON "horizon_account_operations" ("accountId", "createdAt")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_horizon_ops_type" ON "horizon_account_operations" ("type")`,
    );

    // Create horizon_ingest_checkpoints table
    await queryRunner.query(
      `CREATE TABLE "horizon_ingest_checkpoints" (
        "id"         uuid                     NOT NULL DEFAULT uuid_generate_v4(),
        "accountId"  character varying(64)    NOT NULL,
        "cursor"     character varying(64)    NOT NULL DEFAULT '0',
        "updatedAt"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_horizon_ingest_checkpoints" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_horizon_ingest_checkpoints_accountId" UNIQUE ("accountId")
      )`,
    );

    // Create index for horizon_ingest_checkpoints
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_horizon_checkpoint_account" ON "horizon_ingest_checkpoints" ("accountId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_horizon_checkpoint_account"`);
    await queryRunner.query(`DROP TABLE "horizon_ingest_checkpoints"`);
    await queryRunner.query(`DROP INDEX "IDX_horizon_ops_type"`);
    await queryRunner.query(`DROP INDEX "IDX_horizon_ops_account_created"`);
    await queryRunner.query(`DROP TABLE "horizon_account_operations"`);
  }
}
