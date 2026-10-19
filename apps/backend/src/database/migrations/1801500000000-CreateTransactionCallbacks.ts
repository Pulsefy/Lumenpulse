import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `transaction_callbacks` table.
 *
 * The `TransactionCallback` entity had no corresponding migration, so the
 * table was never created by a tracked migration. This base migration runs
 * before `AddWebhookRotationFieldsToTransactionCallbacks` (which adds the
 * webhook rotation columns).
 */
export class CreateTransactionCallbacks1801500000000 implements MigrationInterface {
  name = 'CreateTransactionCallbacks1801500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "transaction_callbacks_status_enum" AS ENUM ('PENDING', 'FINALIZED', 'NOTIFIED', 'FAILED_TO_NOTIFY')`,
    );
    await queryRunner.query(
      `CREATE TABLE "transaction_callbacks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "transactionHash" character varying NOT NULL, "callbackUrl" character varying NOT NULL, "status" "transaction_callbacks_status_enum" NOT NULL DEFAULT 'PENDING', "lastError" text, "retryCount" integer NOT NULL DEFAULT 0, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_transaction_callbacks" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_transaction_callbacks_transactionHash" ON "transaction_callbacks" ("transactionHash")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "transaction_callbacks"`);
    await queryRunner.query(`DROP TYPE "transaction_callbacks_status_enum"`);
  }
}
