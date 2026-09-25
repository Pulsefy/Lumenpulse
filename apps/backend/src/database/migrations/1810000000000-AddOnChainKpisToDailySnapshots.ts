import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOnChainKpisToDailySnapshots1810000000000 implements MigrationInterface {
  name = 'AddOnChainKpisToDailySnapshots1810000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "daily_snapshots" ADD "tvl" numeric(20,4)`,
    );
    await queryRunner.query(
      `ALTER TABLE "daily_snapshots" ADD "active_rounds" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "daily_snapshots" ADD "contribution_count" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "daily_snapshots" ADD "total_contribution_amount" numeric(20,4)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "daily_snapshots" DROP COLUMN "total_contribution_amount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "daily_snapshots" DROP COLUMN "contribution_count"`,
    );
    await queryRunner.query(
      `ALTER TABLE "daily_snapshots" DROP COLUMN "active_rounds"`,
    );
    await queryRunner.query(`ALTER TABLE "daily_snapshots" DROP COLUMN "tvl"`);
  }
}
