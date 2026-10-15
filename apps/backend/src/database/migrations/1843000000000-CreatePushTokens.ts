import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `push_tokens` table used by the notification service. The
 * `PushToken` entity had no corresponding migration, so the table was never
 * created by a tracked migration and the schema-drift check in CI flagged it
 * as missing.
 */
export class CreatePushTokens1843000000000 implements MigrationInterface {
  name = 'CreatePushTokens1843000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "push_tokens_platform_enum" AS ENUM ('ios', 'android', 'web')`,
    );
    await queryRunner.query(
      `CREATE TABLE "push_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "token" character varying(255) NOT NULL, "deviceId" character varying(255) NOT NULL, "platform" "push_tokens_platform_enum" NOT NULL DEFAULT 'android', "deviceName" character varying(255), "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_push_tokens" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_push_tokens_token" ON "push_tokens" ("token")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_push_tokens_userId" ON "push_tokens" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_push_tokens_isActive" ON "push_tokens" ("isActive")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_push_tokens_user_active" ON "push_tokens" ("userId", "isActive")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_push_tokens_device_platform" ON "push_tokens" ("deviceId", "platform")`,
    );
    await queryRunner.query(
      `ALTER TABLE "push_tokens" ADD CONSTRAINT "FK_push_tokens_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "push_tokens"`);
    await queryRunner.query(`DROP TYPE "push_tokens_platform_enum"`);
  }
}
