import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `users.deletedAt`, the tombstone marker written by the user-data
 * erasure flow (`UserDataDeletionService`). A non-null value means the account
 * has been anonymised, keeps a valid id for records that must be retained by
 * audit/moderation (foreign keys with `RESTRICT`/`NO ACTION`), and must no
 * longer be able to authenticate.
 *
 * The column is nullable, so the change is metadata-only on Postgres and does
 * not rewrite the table.
 */
export class AddDeletedAtToUsers1853000000000 implements MigrationInterface {
  name = 'AddDeletedAtToUsers1853000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "deletedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "deletedAt"`);
  }
}
