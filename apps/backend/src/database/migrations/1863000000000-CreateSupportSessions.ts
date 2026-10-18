import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSupportSessions1863000000000 implements MigrationInterface {
  name = 'CreateSupportSessions1863000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "support_sessions" (
        "id" uuid PRIMARY KEY DEFAULT GEN_RANDOM_UUID(),
        "actorId" uuid NOT NULL,
        "subjectId" uuid NOT NULL,
        "tokenHash" varchar(64) NOT NULL UNIQUE,
        "startedAt" timestamp with time zone NOT NULL DEFAULT NOW(),
        "expiresAt" timestamp with time zone NOT NULL,
        "endedAt" timestamp with time zone,
        "endedReason" varchar(32),
        "endpointsAccessed" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "requestCount" integer NOT NULL DEFAULT 0,
        "notifiedAt" timestamp with time zone,
        "createdAt" timestamp with time zone NOT NULL DEFAULT NOW(),
        "updatedAt" timestamp with time zone NOT NULL DEFAULT NOW(),
        CONSTRAINT fkz_support_sessions_actor_fk FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT fkz_support_sessions_subject_fk FOREIGN KEY ("subjectId") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT ck_support_sessions_distinct_parties CHECK ("actorId" <> "subjectId"),
        CONSTRAINT ck_support_sessions_expiry CHECK ("expiresAt" > "startedAt")
      );
    
`);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_support_sessions_actor"
        ON "support_sessions" ("actorId", "startedAt" DESC);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_support_sessions_subject"
        ON "support_sessions" ("subjectId", "startedAt" DESC);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_support_sessions_expires_at"
        ON "support_sessions" ("expiresAt")
        WHERE "endedAt" IS NULL;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_support_sessions_expires_at";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_support_sessions_subject";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_support_sessions_actor";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "support_sessions";`);
  }
}
