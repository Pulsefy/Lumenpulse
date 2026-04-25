import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRefreshTokens1769900000000 implements MigrationInterface {
  name = 'CreateRefreshTokens1769900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tableExists = await queryRunner.hasTable('refresh_tokens');

    if (!tableExists) {
      await queryRunner.query(
        `CREATE TABLE "refresh_tokens" (
          "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
          "tokenHash" character varying(255) NOT NULL,
          "userId" uuid NOT NULL,
          "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
          "revokedAt" TIMESTAMP WITH TIME ZONE DEFAULT NULL,
          "deviceInfo" character varying(255) DEFAULT NULL,
          "ipAddress" character varying(45) DEFAULT NULL,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          CONSTRAINT "PK_refresh_tokens" PRIMARY KEY ("id"),
          CONSTRAINT "FK_refresh_tokens_user" FOREIGN KEY ("userId")
            REFERENCES "users"("id") ON DELETE CASCADE
        )`,
      );

      await queryRunner.query(
        `CREATE INDEX "IDX_refresh_tokens_tokenHash" ON "refresh_tokens" ("tokenHash")`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_refresh_tokens_userId" ON "refresh_tokens" ("userId")`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_refresh_tokens_userId_revokedAt" ON "refresh_tokens" ("userId", "revokedAt")`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tableExists = await queryRunner.hasTable('refresh_tokens');

    if (tableExists) {
      await queryRunner.query(
        `DROP INDEX "public"."IDX_refresh_tokens_userId_revokedAt"`,
      );
      await queryRunner.query(
        `DROP INDEX "public"."IDX_refresh_tokens_userId"`,
      );
      await queryRunner.query(
        `DROP INDEX "public"."IDX_refresh_tokens_tokenHash"`,
      );
      await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    }
  }
}
