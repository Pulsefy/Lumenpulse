import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `watchlist_items` table.
 *
 * Reconciles the legacy migration that used to live in the untracked
 * `src/migrations` directory. Idempotent guards make it safe to run on both
 * fresh and already-migrated databases.
 */
export class CreateWatchlistItems1770000000001 implements MigrationInterface {
  name = 'CreateWatchlistItems1770000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$ BEGIN CREATE TYPE "public"."watchlist_items_type_enum" AS ENUM('asset', 'project'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "watchlist_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "symbol" character varying(50) NOT NULL,
        "name" character varying(255),
        "type" "public"."watchlist_items_type_enum" NOT NULL DEFAULT 'asset',
        "assetIssuer" character varying(56),
        "imageUrl" character varying(500),
        "notes" text,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_watchlist_items" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_watchlist_items_user_symbol_type" ON "watchlist_items" ("userId", "symbol", "type")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_watchlist_items_userId" ON "watchlist_items" ("userId")`,
    );

    await queryRunner.query(
      `DO $$ BEGIN ALTER TABLE "watchlist_items" ADD CONSTRAINT "FK_watchlist_items_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "watchlist_items" DROP CONSTRAINT IF EXISTS "FK_watchlist_items_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_watchlist_items_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_watchlist_items_user_symbol_type"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "watchlist_items"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."watchlist_items_type_enum"`,
    );
  }
}
