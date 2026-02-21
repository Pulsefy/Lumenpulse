import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePasswordResetTokensOnly1769500000001 implements MigrationInterface {
  name = 'CreatePasswordResetTokensOnly1769500000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if table already exists to avoid conflicts
    const tableExists = await queryRunner.hasTable('password_reset_tokens');

    if (!tableExists) {
      await queryRunner.query(
        `CREATE TABLE "password_reset_tokens" (
          "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
          "tokenHash" character varying(255) NOT NULL,
          "userId" uuid NOT NULL,
          "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
          "usedAt" TIMESTAMP WITH TIME ZONE,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          CONSTRAINT "PK_password_reset_tokens" PRIMARY KEY ("id"),
          CONSTRAINT "FK_password_reset_tokens_user" FOREIGN KEY ("userId")
            REFERENCES "users"("id") ON DELETE CASCADE
        )`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_password_reset_tokens_tokenHash" ON "password_reset_tokens" ("tokenHash")`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_password_reset_tokens_userId" ON "password_reset_tokens" ("userId")`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tableExists = await queryRunner.hasTable('password_reset_tokens');

    if (tableExists) {
      await queryRunner.query(
        `DROP INDEX "public"."IDX_password_reset_tokens_userId"`,
      );
      await queryRunner.query(
        `DROP INDEX "public"."IDX_password_reset_tokens_tokenHash"`,
      );
      await queryRunner.query(`DROP TABLE "password_reset_tokens"`);
    }
  }
}
