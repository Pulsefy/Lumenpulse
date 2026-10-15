import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVerificationRequests1801000000000 implements MigrationInterface {
  name = 'CreateVerificationRequests1801000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "verification_requests_targettype_enum" AS ENUM ('CONTRIBUTOR', 'PROJECT')`,
    );
    await queryRunner.query(
      `CREATE TYPE "verification_requests_status_enum" AS ENUM ('SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "verification_requests" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "targetType" "verification_requests_targettype_enum" NOT NULL, "targetId" character varying(255) NOT NULL, "requesterId" uuid NOT NULL, "status" "verification_requests_status_enum" NOT NULL, "evidence" text NOT NULL, "requesterNote" text, "reviewerId" uuid, "reviewNote" text, "reviewedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL DEFAULT 1, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_verification_requests" PRIMARY KEY ("id"), CONSTRAINT "FK_verification_requests_requester" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE RESTRICT, CONSTRAINT "FK_verification_requests_reviewer" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_verification_requests_target" ON "verification_requests" ("targetType", "targetId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_verification_requests_requester_status" ON "verification_requests" ("requesterId", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_verification_requests_status_created" ON "verification_requests" ("status", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "verification_requests"`);
    await queryRunner.query(`DROP TYPE "verification_requests_status_enum"`);
    await queryRunner.query(
      `DROP TYPE "verification_requests_targettype_enum"`,
    );
  }
}
