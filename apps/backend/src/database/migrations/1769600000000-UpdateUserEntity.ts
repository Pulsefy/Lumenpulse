import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateUserEntity1769600000000 implements MigrationInterface {
  name = 'UpdateUserEntity1769600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "firstName" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "lastName" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "stellarPublicKey" character varying(255)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_users_stellarPublicKey" ON "users" ("stellarPublicKey") `,
    );
    // Allow email to be nullable (for stellar-only users)
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_users_stellarPublicKey"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "stellarPublicKey"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "lastName"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "firstName"`);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL`,
    );
  }
}
