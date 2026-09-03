import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReviewCommentsAndDecisionHistory1850000000000 implements MigrationInterface {
  name = 'CreateReviewCommentsAndDecisionHistory1850000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum types for review comments
    await queryRunner.query(`
      CREATE TYPE "review_comments_visibility_enum" AS ENUM('public', 'internal')
    `);

    // Create enum types for review decisions
    await queryRunner.query(`
      CREATE TYPE "review_decision_history_decisionType_enum" AS ENUM('approved', 'rejected', 'deferred', 'escalated')
    `);

    // Create review_comments table
    await queryRunner.query(`
      CREATE TABLE "review_comments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "target_id" character varying NOT NULL,
        "target_type" character varying(50) NOT NULL,
        "visibility" "review_comments_visibility_enum" NOT NULL DEFAULT 'public',
        "author_id" uuid NOT NULL,
        "content" text NOT NULL,
        "parent_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_review_comments" PRIMARY KEY ("id")
      )
    `);

    // Add foreign key constraint for author
    await queryRunner.query(`
      ALTER TABLE "review_comments"
      ADD CONSTRAINT "FK_review_comments_author"
      FOREIGN KEY ("author_id") REFERENCES "users"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    // Create indexes for review_comments
    await queryRunner.query(`
      CREATE INDEX "IDX_review_comments_target" ON "review_comments"("target_id", "target_type")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_review_comments_author" ON "review_comments"("author_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_review_comments_visibility" ON "review_comments"("visibility")
    `);

    // Create review_decision_history table
    await queryRunner.query(`
      CREATE TABLE "review_decision_history" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "target_id" character varying NOT NULL,
        "target_type" character varying(50) NOT NULL,
        "decisionType" "review_decision_history_decisionType_enum" NOT NULL,
        "reviewer_id" uuid NOT NULL,
        "rationale" text,
        "metadata" jsonb,
        "previous_decision" character varying(50),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_review_decision_history" PRIMARY KEY ("id")
      )
    `);

    // Add foreign key constraint for reviewer
    await queryRunner.query(`
      ALTER TABLE "review_decision_history"
      ADD CONSTRAINT "FK_review_decision_history_reviewer"
      FOREIGN KEY ("reviewer_id") REFERENCES "users"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    // Create indexes for review_decision_history
    await queryRunner.query(`
      CREATE INDEX "IDX_review_decision_history_target" ON "review_decision_history"("target_id", "target_type")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_review_decision_history_reviewer" ON "review_decision_history"("reviewer_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_review_decision_history_decisionType" ON "review_decision_history"("decisionType")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes for review_decision_history
    await queryRunner.query(
      `DROP INDEX "IDX_review_decision_history_decisionType"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_review_decision_history_reviewer"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_review_decision_history_target"`);

    // Drop foreign key for review_decision_history
    await queryRunner.query(
      `ALTER TABLE "review_decision_history" DROP CONSTRAINT "FK_review_decision_history_reviewer"`,
    );

    // Drop review_decision_history table
    await queryRunner.query(`DROP TABLE "review_decision_history"`);

    // Drop indexes for review_comments
    await queryRunner.query(`DROP INDEX "IDX_review_comments_visibility"`);
    await queryRunner.query(`DROP INDEX "IDX_review_comments_author"`);
    await queryRunner.query(`DROP INDEX "IDX_review_comments_target"`);

    // Drop foreign key for review_comments
    await queryRunner.query(
      `ALTER TABLE "review_comments" DROP CONSTRAINT "FK_review_comments_author"`,
    );

    // Drop review_comments table
    await queryRunner.query(`DROP TABLE "review_comments"`);

    // Drop enum types
    await queryRunner.query(
      `DROP TYPE "review_decision_history_decisionType_enum"`,
    );
    await queryRunner.query(`DROP TYPE "review_comments_visibility_enum"`);
  }
}
