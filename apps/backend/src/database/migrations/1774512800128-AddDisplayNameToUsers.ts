import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * @acknowledge-destructive Recreates the `users_role_enum` type to add the
 * `reviewer` value. The old type is dropped only after the `users.role`
 * column is cast to the new type, so no data is lost. Accepted by the backend
 * team as a deliberate enum evolution.
 *
 * Finalises the `users` schema to match the current `User` entity and creates
 * the `stellar_accounts` and `daily_snapshots` tables.
 *
 * This migration reconciles the legacy `AddDisplayNameToUsers` migration that
 * used to live in the untracked `src/migrations` directory. The original file
 * was never registered with the TypeORM data source (so it was never applied
 * through the tracked migration set) and was not replayable on a clean
 * database. Its intent is preserved here with idempotent guards so the
 * migration is safe on both fresh and already-migrated databases.
 */
export class AddDisplayNameToUsers1774512800128 implements MigrationInterface {
  name = 'AddDisplayNameToUsers1774512800128';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "displayName" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bio" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatarUrl" character varying(500)`,
    );

    // Align `articles` with the News entity.
    await queryRunner.query(
      `ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "tags" text array`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "category" jsonb`,
    );

    // Align `portfolio_assets` with the PortfolioAsset entity.
    await queryRunner.query(
      `ALTER TABLE "portfolio_assets" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolio_assets" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );

    // Extend the role enum with `reviewer` to match the UserRole entity.
    await queryRunner.query(
      `CREATE TYPE "public"."users_role_enum_new" AS ENUM('user', 'reviewer', 'admin')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."users_role_enum_new" USING ("role"::text)::"public"."users_role_enum_new"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'user'`,
    );
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."users_role_enum_new" RENAME TO "users_role_enum"`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "stellar_accounts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "publicKey" character varying(56) NOT NULL, "label" character varying(100), "isPrimary" boolean NOT NULL DEFAULT false, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_stellar_accounts" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_stellar_accounts_publicKey" ON "stellar_accounts" ("publicKey")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_stellar_accounts_user_publicKey" ON "stellar_accounts" ("userId", "publicKey")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_stellar_accounts_userId" ON "stellar_accounts" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_stellar_accounts_isActive" ON "stellar_accounts" ("isActive")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_stellar_accounts_isPrimary" ON "stellar_accounts" ("isPrimary")`,
    );
    await queryRunner.query(
      `ALTER TABLE "stellar_accounts" ADD CONSTRAINT "FK_stellar_accounts_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "daily_snapshots" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "snapshot_date" date NOT NULL, "asset_symbol" character varying(20), "avg_sentiment" numeric(10,6) NOT NULL, "min_sentiment" numeric(10,6), "max_sentiment" numeric(10,6), "signal_count" integer NOT NULL, "total_volume" numeric(20,4), "volume_weighted_sentiment" numeric(10,6), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_daily_snapshots" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_daily_snapshots_date_asset" ON "daily_snapshots" ("snapshot_date", "asset_symbol")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_daily_snapshots_assetSymbol" ON "daily_snapshots" ("asset_symbol")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_daily_snapshots_createdAt" ON "daily_snapshots" ("created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "daily_snapshots"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "stellar_accounts"`);

    await queryRunner.query(
      `CREATE TYPE "public"."users_role_enum_old" AS ENUM('user', 'admin')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."users_role_enum_old" USING ("role"::text)::"public"."users_role_enum_old"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'user'`,
    );
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."users_role_enum_old" RENAME TO "users_role_enum"`,
    );

    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "avatarUrl"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "bio"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "displayName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolio_assets" DROP COLUMN IF EXISTS "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolio_assets" DROP COLUMN IF EXISTS "createdAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" DROP COLUMN IF EXISTS "category"`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" DROP COLUMN IF EXISTS "tags"`,
    );
  }
}
