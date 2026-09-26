import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSavedSearches1860000000000 implements MigrationInterface {
  name = 'CreateSavedSearches1860000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enum for the search domain
    await queryRunner.query(`
      CREATE TYPE "saved_search_domain_enum" AS ENUM ('grants', 'projects', 'news')
    `);

    await queryRunner.query(`
      CREATE TABLE "saved_searches" (
        "id"               uuid                            NOT NULL DEFAULT uuid_generate_v4(),
        "userId"           uuid                            NOT NULL,
        "name"             character varying(120)          NOT NULL,
        "domain"           "saved_search_domain_enum"      NOT NULL DEFAULT 'grants',
        "filters"          jsonb                           NOT NULL DEFAULT '{}',
        "isSubscribed"     boolean                         NOT NULL DEFAULT false,
        "lastNotifiedAt"   TIMESTAMP WITH TIME ZONE,
        "createdAt"        TIMESTAMP WITH TIME ZONE        NOT NULL DEFAULT now(),
        "updatedAt"        TIMESTAMP WITH TIME ZONE        NOT NULL DEFAULT now(),
        CONSTRAINT "PK_saved_searches" PRIMARY KEY ("id"),
        CONSTRAINT "FK_saved_searches_user"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // Support listing a user's searches filtered by domain
    await queryRunner.query(`
      CREATE INDEX "IDX_saved_searches_user_domain"
        ON "saved_searches" ("userId", "domain")
    `);

    // Support listing a user's searches sorted by creation time (default list view)
    await queryRunner.query(`
      CREATE INDEX "IDX_saved_searches_user_created"
        ON "saved_searches" ("userId", "createdAt")
    `);

    // Efficient lookup for the subscription scheduler scan
    await queryRunner.query(`
      CREATE INDEX "IDX_saved_searches_subscribed"
        ON "saved_searches" ("isSubscribed")
        WHERE "isSubscribed" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_saved_searches_subscribed"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_saved_searches_user_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_saved_searches_user_domain"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "saved_searches"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "saved_search_domain_enum"`,
    );
  }
}
