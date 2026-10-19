import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuditLogArchive1851000000000 implements MigrationInterface {
  name = 'CreateAuditLogArchive1851000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_log_archive" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "recordType" character varying(50) NOT NULL,
        "sourceTable" character varying(100) NOT NULL,
        "sourceId" uuid NOT NULL,
        "payload" jsonb NOT NULL,
        "originalCreatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "archivedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_log_archive" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_audit_log_archive_type_created"
      ON "audit_log_archive" ("recordType", "originalCreatedAt")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_audit_log_archive_source"
      ON "audit_log_archive" ("sourceTable", "sourceId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_audit_log_archive_source"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_audit_log_archive_type_created"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_log_archive"`);
  }
}
