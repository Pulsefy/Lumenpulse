import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReviewHistory1820000000000 implements MigrationInterface {
  name = 'CreateReviewHistory1820000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "review_history_decision_enum" AS ENUM('COMMENT', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED', 'PUBLISHED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "review_history" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "submission_id" integer,
        "target_type" character varying(100) NOT NULL,
        "target_id" character varying(255) NOT NULL,
        "decision" "review_history_decision_enum" NOT NULL,
        "comment" text,
        "is_internal" boolean NOT NULL DEFAULT false,
        "actor_id" uuid NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_review_history" PRIMARY KEY ("id"),
        CONSTRAINT "FK_review_history_actor" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT
      )`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_review_history_submission_created" ON "review_history" ("submission_id", "created_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_review_history_target_created" ON "review_history" ("target_type", "target_id", "created_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_review_history_target_created"`);
    await queryRunner.query(`DROP INDEX "IDX_review_history_submission_created"`);
    await queryRunner.query(`DROP TABLE "review_history"`);
    await queryRunner.query(`DROP TYPE "review_history_decision_enum"`);
  }
}
