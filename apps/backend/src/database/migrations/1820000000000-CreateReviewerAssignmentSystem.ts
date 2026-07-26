import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReviewerAssignmentSystem1820000000000
  implements MigrationInterface
{
  name = 'CreateReviewerAssignmentSystem1820000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum types
    await queryRunner.query(`
      CREATE TYPE "reviewer_assignment_state_enum" AS ENUM('unassigned', 'in_review', 'completed')
    `);

    // Create reviewer_assignments table
    await queryRunner.query(`
      CREATE TABLE "reviewer_assignments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "item_id" uuid NOT NULL,
        "item_type" character varying NOT NULL,
        "state" "reviewer_assignment_state_enum" NOT NULL DEFAULT 'unassigned',
        "reviewer_id" uuid,
        "assigned_by_id" uuid,
        "assigned_at" TIMESTAMP,
        "completed_at" TIMESTAMP,
        "priority" integer DEFAULT 0,
        "metadata" jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reviewer_assignments" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_reviewer_assignments_item" UNIQUE ("item_id", "item_type")
      )
    `);

    // Add foreign key constraints
    await queryRunner.query(`
      ALTER TABLE "reviewer_assignments"
      ADD CONSTRAINT "FK_reviewer_assignments_reviewer"
      FOREIGN KEY ("reviewer_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "reviewer_assignments"
      ADD CONSTRAINT "FK_reviewer_assignments_assigned_by"
      FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    // Create indexes for performance
    await queryRunner.query(`
      CREATE INDEX "IDX_reviewer_assignments_state" ON "reviewer_assignments"("state")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_reviewer_assignments_reviewer" ON "reviewer_assignments"("reviewer_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_reviewer_assignments_item" ON "reviewer_assignments"("item_id", "item_type")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_reviewer_assignments_created" ON "reviewer_assignments"("created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_reviewer_assignments_priority" ON "reviewer_assignments"("priority" DESC, "created_at" DESC)
    `);

    // Create assignment_audit_logs table for tracking all changes
    await queryRunner.query(`
      CREATE TABLE "assignment_audit_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "assignment_id" uuid NOT NULL,
        "item_id" uuid NOT NULL,
        "item_type" character varying NOT NULL,
        "action" character varying NOT NULL,
        "previous_state" "reviewer_assignment_state_enum",
        "new_state" "reviewer_assignment_state_enum",
        "previous_reviewer_id" uuid,
        "new_reviewer_id" uuid,
        "actor_id" uuid NOT NULL,
        "actor_email" character varying,
        "reason" text,
        "metadata" jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_assignment_audit_logs" PRIMARY KEY ("id")
      )
    `);

    // Add foreign key constraints for audit logs
    await queryRunner.query(`
      ALTER TABLE "assignment_audit_logs"
      ADD CONSTRAINT "FK_assignment_audit_logs_assignment"
      FOREIGN KEY ("assignment_id") REFERENCES "reviewer_assignments"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "assignment_audit_logs"
      ADD CONSTRAINT "FK_assignment_audit_logs_actor"
      FOREIGN KEY ("actor_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "assignment_audit_logs"
      ADD CONSTRAINT "FK_assignment_audit_logs_new_reviewer"
      FOREIGN KEY ("new_reviewer_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "assignment_audit_logs"
      ADD CONSTRAINT "FK_assignment_audit_logs_previous_reviewer"
      FOREIGN KEY ("previous_reviewer_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);

    // Create indexes for audit logs
    await queryRunner.query(`
      CREATE INDEX "IDX_assignment_audit_logs_assignment" ON "assignment_audit_logs"("assignment_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_assignment_audit_logs_actor" ON "assignment_audit_logs"("actor_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_assignment_audit_logs_item" ON "assignment_audit_logs"("item_id", "item_type")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_assignment_audit_logs_created" ON "assignment_audit_logs"("created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX "IDX_assignment_audit_logs_created"`);
    await queryRunner.query(`DROP INDEX "IDX_assignment_audit_logs_item"`);
    await queryRunner.query(`DROP INDEX "IDX_assignment_audit_logs_actor"`);
    await queryRunner.query(`DROP INDEX "IDX_assignment_audit_logs_assignment"`);

    await queryRunner.query(`DROP INDEX "IDX_reviewer_assignments_priority"`);
    await queryRunner.query(`DROP INDEX "IDX_reviewer_assignments_created"`);
    await queryRunner.query(`DROP INDEX "IDX_reviewer_assignments_item"`);
    await queryRunner.query(`DROP INDEX "IDX_reviewer_assignments_reviewer"`);
    await queryRunner.query(`DROP INDEX "IDX_reviewer_assignments_state"`);

    // Drop foreign keys
    await queryRunner.query(
      `ALTER TABLE "assignment_audit_logs" DROP CONSTRAINT "FK_assignment_audit_logs_previous_reviewer"`,
    );
    await queryRunner.query(
      `ALTER TABLE "assignment_audit_logs" DROP CONSTRAINT "FK_assignment_audit_logs_new_reviewer"`,
    );
    await queryRunner.query(
      `ALTER TABLE "assignment_audit_logs" DROP CONSTRAINT "FK_assignment_audit_logs_actor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "assignment_audit_logs" DROP CONSTRAINT "FK_assignment_audit_logs_assignment"`,
    );

    await queryRunner.query(
      `ALTER TABLE "reviewer_assignments" DROP CONSTRAINT "FK_reviewer_assignments_assigned_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reviewer_assignments" DROP CONSTRAINT "FK_reviewer_assignments_reviewer"`,
    );

    // Drop tables
    await queryRunner.query(`DROP TABLE "assignment_audit_logs"`);
    await queryRunner.query(`DROP TABLE "reviewer_assignments"`);

    // Drop enum types
    await queryRunner.query(`DROP TYPE "reviewer_assignment_state_enum"`);
  }
}
