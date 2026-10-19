import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSupportSessions1863000000000 implements MigrationInterface {
  name = 'CreateSupportSessions1863000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "support_sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "actorId" uuid NOT NULL,
        "subjectId" uuid NOT NULL,
        "reason" character varying(500) NOT NULL,
        "ipAddress" character varying(45),
        "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "endedAt" TIMESTAMP WITH TIME ZONE,
        "endpoints" jsonb NOT NULL DEFAULT '[]'::jsonb,
        CONSTRAINT "PK_support_sessions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_support_sessions_actor_started" ON "support_sessions" ("actorId", "startedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_support_sessions_subject_started" ON "support_sessions" ("subjectId", "startedAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_support_sessions_subject_started"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_support_sessions_actor_started"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "support_sessions"`);
  }
}
