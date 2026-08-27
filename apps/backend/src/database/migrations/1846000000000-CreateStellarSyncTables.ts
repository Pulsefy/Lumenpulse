import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the Stellar sync bookkeeping tables (`stellar_processed_events`
 * and `stellar_sync_checkpoints`). Neither entity had a corresponding
 * migration, so the tables were never created by a tracked migration and the
 * schema-drift check in CI flagged them as missing.
 */
export class CreateStellarSyncTables1846000000000 implements MigrationInterface {
  name = 'CreateStellarSyncTables1846000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "stellar_processed_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "eventId" character varying NOT NULL, "processedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_stellar_processed_events" PRIMARY KEY ("id"), CONSTRAINT "UQ_stellar_processed_events_eventId" UNIQUE ("eventId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_stellar_processed_events_processedAt" ON "stellar_processed_events" ("processedAt")`,
    );
    await queryRunner.query(
      `CREATE TABLE "stellar_sync_checkpoints" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "type" character varying NOT NULL, "cursor" character varying NOT NULL, "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_stellar_sync_checkpoints" PRIMARY KEY ("id"), CONSTRAINT "UQ_stellar_sync_checkpoints_type" UNIQUE ("type"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_stellar_sync_checkpoints_updatedAt" ON "stellar_sync_checkpoints" ("updatedAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "stellar_sync_checkpoints"`);
    await queryRunner.query(`DROP TABLE "stellar_processed_events"`);
  }
}
