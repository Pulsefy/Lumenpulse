import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReportEntity1770000000000 implements MigrationInterface {
  name = 'CreateReportEntity1770000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "reports_contenttype_enum" AS ENUM('project', 'user_content', 'comment', 'post')
    `);
    await queryRunner.query(`
      CREATE TYPE "reports_status_enum" AS ENUM('pending', 'reviewed', 'resolved', 'dismissed')
    `);
    await queryRunner.query(`
      CREATE TABLE "reports" (
        "id" SERIAL NOT NULL,
        "reporterId" integer NOT NULL,
        "contentType" "reports_contenttype_enum" NOT NULL,
        "contentId" varchar NOT NULL,
        "reason" varchar NOT NULL,
        "description" text,
        "status" "reports_status_enum" NOT NULL DEFAULT 'pending',
        "reviewedBy" integer,
        "reviewNotes" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_4c88e956195bba85977da21b8f4" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_4c88e956195bba85977da21b8f4" ON "reports" ("reporterId")
    `);
    await queryRunner.query(`
      ALTER TABLE "reports"
      ADD CONSTRAINT "FK_4c88e956195bba85977da21b8f4"
      FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "reports" DROP CONSTRAINT "FK_4c88e956195bba85977da21b8f4"
    `);
    await queryRunner.query(`DROP INDEX "IDX_4c88e956195bba85977da21b8f4"`);
    await queryRunner.query(`DROP TABLE "reports"`);
    await queryRunner.query(`DROP TYPE "reports_status_enum"`);
    await queryRunner.query(`DROP TYPE "reports_contenttype_enum"`);
  }
}