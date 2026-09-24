import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCorrelationIdToOutboxEvents1851000000000 implements MigrationInterface {
  name = 'AddCorrelationIdToOutboxEvents1851000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "outbox_events" ADD COLUMN "correlationId" character varying(128)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "outbox_events" DROP COLUMN "correlationId"`,
    );
  }
}
