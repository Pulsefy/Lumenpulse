import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWatchlistItems1745500000000 implements MigrationInterface {
  name = 'CreateWatchlistItems1745500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the enum type for watchlist item type
    await queryRunner.query(
      `CREATE TYPE "public"."watchlist_items_type_enum" AS ENUM('asset', 'project')`,
    );

    // Create the watchlist_items table
    await queryRunner.query(
      `CREATE TABLE "watchlist_items" (
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

    // Create unique constraint for userId + symbol + type
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_watchlist_items_user_symbol_type" ON "watchlist_items" ("userId", "symbol", "type")`,
    );

    // Create index on userId for fast user lookups
    await queryRunner.query(
      `CREATE INDEX "IDX_watchlist_items_userId" ON "watchlist_items" ("userId")`,
    );

    // Add foreign key constraint to users table
    await queryRunner.query(
      `ALTER TABLE "watchlist_items" ADD CONSTRAINT "FK_watchlist_items_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign key constraint
    await queryRunner.query(
      `ALTER TABLE "watchlist_items" DROP CONSTRAINT "FK_watchlist_items_userId"`,
    );

    // Drop indexes
    await queryRunner.query(
      `DROP INDEX "public"."IDX_watchlist_items_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_watchlist_items_user_symbol_type"`,
    );

    // Drop table
    await queryRunner.query(`DROP TABLE "watchlist_items"`);

    // Drop enum type
    await queryRunner.query(
      `DROP TYPE "public"."watchlist_items_type_enum"`,
    );
  }
}
