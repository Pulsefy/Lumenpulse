import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds soft-delete columns to the core entities (crowdfund projects,
 * grant rounds and verification requests).
 *
 * Each table gains:
 *   - "deletedAt"      - timestamp of the soft delete (NULL when live)
 *   - "deletedBy"      - id of the actor that deleted the row
 *   - "deletionReason" - optional free-text reason
 *   - "purgeAfter"    - when the row becomes eligible for permanent purge
 *
 * Partial indexes on "deletedAt" keep the normal (live) queries fast and
 * give the purge job a cheap way to find expired rows. The retention window
 * is 30 days (documented in DATA_RETENTION.md and the soft-delete service).
 */
export class AddSoftDeleteToCoreEntities1865000000000 implements MigrationInterface {
  name = 'AddSoftDeleteToCoreEntities1865000000000';

  /** Tables that gain soft-delete columns. */
  private readonly targets = [
    'project_registry',
    'grant_rounds',
    'verification_requests',
  ] as const;

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of this.targets) {
      await queryRunner.query(
        `ALTER TABLE IF EXISTS "${table}"
           ADD COLUMN IF NOT EXISTS "deletedAt" timestamp with time zone,
           ADD COLUMN IF NOT EXISTS "deletedBy" varchar(255),
           ADD COLUMN IF NOT EXISTS "deletionReason" text,
           ADD COLUMN IF NOT EXISTS "purgeAfter" timestamp with time zone`,
      );

      // Partial index so live rows are cheap to query and the purge job
      // can find expired rows without a full scan.
      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS "idx_soft_delete_${table}_deletedAt"
           ON "${table}" ("deletedAt")
           WHERE "deletedAt" IS NOT NULL`,
      );

      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS "idx_soft_delete_${table}_purgeAfter"
           ON "${table}" ("purgeAfter")
           WHERE "deletedAt" IS NOT NULL`,
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of this.targets) {
      await queryRunner.query(
        `DROP INDEX IF EXISTS "idx_soft_delete_${table}_deletedAt"`,
      );
      await queryRunner.query(
        `DROP INDEX IF EXISTS "idx_soft_delete_${table}_purgeAfter"`,
      );
      await queryRunner.query(
        `ALTER TABLE IF EXISTS "${table}"
           DROP COLUMN IF EXISTS "deletedAt",
           DROP COLUMN IF EXISTS "deletedBy",
           DROP COLUMN IF EXISTS "deletionReason",
           DROP COLUMN IF EXISTS "purgeAfter"`,
      );
    }
  }
}
