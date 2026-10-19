import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Turns `refresh_tokens` into a usable session registry by recording a coarse
 * location hint and the last time the session was seen. Both columns are
 * nullable, so the change is metadata-only on Postgres.
 */
export class AddSessionMetadataToRefreshTokens1864000000000 implements MigrationInterface {
  name = 'AddSessionMetadataToRefreshTokens1864000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD COLUMN "locationHint" character varying(128)`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD COLUMN "lastSeenAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP COLUMN "lastSeenAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP COLUMN "locationHint"`,
    );
  }
}
