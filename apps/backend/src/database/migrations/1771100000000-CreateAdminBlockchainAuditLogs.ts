import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdminBlockchainAuditLogs1771100000000
  implements MigrationInterface
{
  name = 'CreateAdminBlockchainAuditLogs1771100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "admin_blockchain_audit_logs" (
        "id"             uuid              NOT NULL DEFAULT uuid_generate_v4(),
        "actorId"        character varying(255) NOT NULL,
        "actorEmail"     character varying(255),
        "endpoint"       character varying(500) NOT NULL,
        "targetContract" character varying(500),
        "paramsSummary"  jsonb,
        "txHash"         character varying(255),
        "responseStatus" integer,
        "createdAt"      TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_blockchain_audit_logs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_audit_actorId" ON "admin_blockchain_audit_logs" ("actorId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_endpoint" ON "admin_blockchain_audit_logs" ("endpoint")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_createdAt" ON "admin_blockchain_audit_logs" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_audit_createdAt"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_audit_endpoint"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_audit_actorId"`,
    );
    await queryRunner.query(`DROP TABLE "admin_blockchain_audit_logs"`);
  }
}
