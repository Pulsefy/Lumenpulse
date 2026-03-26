import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserPreferences1769800000000 implements MigrationInterface {
  name = 'AddUserPreferences1769800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "preferences" jsonb NOT NULL DEFAULT '{"notifications":{"priceAlerts":true,"newsAlerts":true,"securityAlerts":true}}'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "preferences"`);
  }
}
