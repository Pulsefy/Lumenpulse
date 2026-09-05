import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSavedSearches1848000000000 implements MigrationInterface {
  name = 'CreateSavedSearches1848000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "saved_searches" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(), 
        "userId" uuid NOT NULL, 
        "name" character varying(255) NOT NULL, 
        "domain" character varying(50) NOT NULL DEFAULT 'projects', 
        "query" jsonb NOT NULL, 
        "notifyOnNewResults" boolean NOT NULL DEFAULT false, 
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), 
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), 
        CONSTRAINT "PK_saved_searches_id" PRIMARY KEY ("id")
      )`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_saved_searches_userId" ON "saved_searches" ("userId") `
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_saved_searches_userId"`);
    await queryRunner.query(`DROP TABLE "saved_searches"`);
  }
}
