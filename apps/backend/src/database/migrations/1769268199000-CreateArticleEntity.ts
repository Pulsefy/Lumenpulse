import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateArticleEntity1769268199000 implements MigrationInterface {
  name = 'CreateArticleEntity1769268199000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "articles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying NOT NULL, "url" character varying NOT NULL, "source" character varying NOT NULL, "publishedAt" TIMESTAMP NOT NULL, "sentimentScore" numeric(10,4), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_0a6e2c450d83e0b6052c2793334" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_articles_url" ON "articles" ("url") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_articles_url"`,
    );
    await queryRunner.query(`DROP TABLE "articles"`);
  }
}
