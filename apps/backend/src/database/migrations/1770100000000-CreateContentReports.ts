import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateContentReports1770100000000 implements MigrationInterface {
  name = 'CreateContentReports1770100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum types
    await queryRunner.query(`
      CREATE TYPE "content_reports_target_type_enum" AS ENUM('project', 'comment', 'user', 'other')
    `);

    await queryRunner.query(`
      CREATE TYPE "content_reports_reason_enum" AS ENUM('spam', 'inappropriate_content', 'fraud', 'misleading_info', 'copyright_violation', 'other')
    `);

    await queryRunner.query(`
      CREATE TYPE "content_reports_status_enum" AS ENUM('pending', 'under_review', 'resolved', 'dismissed')
    `);

    // Create content_reports table
    await queryRunner.query(`
      CREATE TABLE "content_reports" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "target_type" "content_reports_target_type_enum" NOT NULL,
        "target_id" character varying NOT NULL,
        "reason" "content_reports_reason_enum" NOT NULL,
        "description" text,
        "status" "content_reports_status_enum" NOT NULL DEFAULT 'pending',
        "reporter_id" uuid NOT NULL,
        "reviewer_id" uuid,
        "review_notes" text,
        "resolved_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_content_reports" PRIMARY KEY ("id")
      )
    `);

    // Add foreign key constraints
    await queryRunner.query(`
      ALTER TABLE "content_reports"
      ADD CONSTRAINT "FK_content_reports_reporter"
      FOREIGN KEY ("reporter_id") REFERENCES "users"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "content_reports"
      ADD CONSTRAINT "FK_content_reports_reviewer"
      FOREIGN KEY ("reviewer_id") REFERENCES "users"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    // Create indexes for performance
    await queryRunner.query(`
      CREATE INDEX "IDX_content_reports_target" ON "content_reports"("target_id", "target_type")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_content_reports_status" ON "content_reports"("status")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_content_reports_reporter" ON "content_reports"("reporter_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX "IDX_content_reports_reporter"`);
    await queryRunner.query(`DROP INDEX "IDX_content_reports_status"`);
    await queryRunner.query(`DROP INDEX "IDX_content_reports_target"`);

    // Drop foreign keys
    await queryRunner.query(
      `ALTER TABLE "content_reports" DROP CONSTRAINT "FK_content_reports_reviewer"`,
    );
    await queryRunner.query(
      `ALTER TABLE "content_reports" DROP CONSTRAINT "FK_content_reports_reporter"`,
    );

    // Drop table
    await queryRunner.query(`DROP TABLE "content_reports"`);

    // Drop enum types
    await queryRunner.query(`DROP TYPE "content_reports_status_enum"`);
    await queryRunner.query(`DROP TYPE "content_reports_reason_enum"`);
    await queryRunner.query(`DROP TYPE "content_reports_target_type_enum"`);
  }
}
