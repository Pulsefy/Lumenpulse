import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTwoFactorAuth1770000000000 implements MigrationInterface {
  name = 'AddTwoFactorAuth1770000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add 2FA columns to users table
    await queryRunner.query(
      `ALTER TABLE "users" ADD "twoFactorSecret" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "twoFactorEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "twoFactorPending" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove 2FA columns from users table
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "twoFactorPending"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "twoFactorEnabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "twoFactorSecret"`,
    );
  }
}
