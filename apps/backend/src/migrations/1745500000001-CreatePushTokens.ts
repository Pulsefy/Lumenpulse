import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePushTokens1745500000001 implements MigrationInterface {
  name = 'CreatePushTokens1745500000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the enum type for push token platform
    await queryRunner.query(
      `CREATE TYPE "public"."push_tokens_platform_enum" AS ENUM('ios', 'android', 'web')`,
    );

    // Create the push_tokens table
    await queryRunner.query(
      `CREATE TABLE "push_tokens" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "token" character varying(255) NOT NULL,
        "platform" "public"."push_tokens_platform_enum" NOT NULL DEFAULT 'android',
        "deviceName" character varying(255),
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_push_tokens" PRIMARY KEY ("id")
      )`,
    );

    // Create unique index on token
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_push_tokens_token" ON "push_tokens" ("token")`,
    );

    // Create index on userId for fast lookups
    await queryRunner.query(
      `CREATE INDEX "IDX_push_tokens_userId" ON "push_tokens" ("userId")`,
    );

    // Add foreign key constraint to users table
    await queryRunner.query(
      `ALTER TABLE "push_tokens" ADD CONSTRAINT "FK_push_tokens_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign key constraint
    await queryRunner.query(
      `ALTER TABLE "push_tokens" DROP CONSTRAINT "FK_push_tokens_userId"`,
    );

    // Drop indexes
    await queryRunner.query(
      `DROP INDEX "public"."IDX_push_tokens_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_push_tokens_token"`,
    );

    // Drop table
    await queryRunner.query(`DROP TABLE "push_tokens"`);

    // Drop enum type
    await queryRunner.query(
      `DROP TYPE "public"."push_tokens_platform_enum"`,
    );
  }
}
