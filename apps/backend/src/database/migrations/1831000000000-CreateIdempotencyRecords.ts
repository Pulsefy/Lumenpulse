import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateIdempotencyRecords1831000000000 implements MigrationInterface {
  name = 'CreateIdempotencyRecords1831000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "idempotency_records_status_enum" AS ENUM ('in_progress', 'completed')`,
    );

    await queryRunner.query(`
      CREATE TABLE "idempotency_records" (
        "id"              uuid                                   NOT NULL DEFAULT uuid_generate_v4(),
        "key"             character varying(128)                 NOT NULL,
        "method"          character varying(16)                  NOT NULL,
        "route"           character varying(512)                 NOT NULL,
        "requestHash"     character varying(64)                  NOT NULL,
        "status"          "idempotency_records_status_enum"      NOT NULL DEFAULT 'in_progress',
        "responseStatus"  integer,
        "responseBody"    jsonb,
        "leaseExpiresAt"  TIMESTAMP WITH TIME ZONE               NOT NULL,
        "expiresAt"       TIMESTAMP WITH TIME ZONE               NOT NULL,
        "completedAt"     TIMESTAMP WITH TIME ZONE,
        "createdAt"       TIMESTAMP WITH TIME ZONE               NOT NULL DEFAULT now(),
        CONSTRAINT "PK_idempotency_records" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_idempotency_key_method_route" ON "idempotency_records" ("key", "method", "route")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_idempotency_expires_at" ON "idempotency_records" ("expiresAt")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_idempotency_status_lease" ON "idempotency_records" ("status", "leaseExpiresAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_idempotency_status_lease"`);
    await queryRunner.query(`DROP INDEX "IDX_idempotency_expires_at"`);
    await queryRunner.query(`DROP INDEX "IDX_idempotency_key_method_route"`);
    await queryRunner.query(`DROP TABLE "idempotency_records"`);
    await queryRunner.query(`DROP TYPE "idempotency_records_status_enum"`);
  }
}
