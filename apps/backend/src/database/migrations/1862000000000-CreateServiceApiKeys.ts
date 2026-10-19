import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateServiceApiKeys1862000000000 implements MigrationInterface {
  name = 'CreateServiceApiKeys1862000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "service_api_keys" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "consumerId" character varying(120) NOT NULL,
        "name" character varying(120),
        "keyPrefix" character varying(16) NOT NULL,
        "keyHash" character(64) NOT NULL,
        "scopes" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "expiresAt" TIMESTAMP WITH TIME ZONE,
        "revokedAt" TIMESTAMP WITH TIME ZONE,
        "createdBy" uuid,
        "revokedBy" uuid,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "lastUsedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_service_api_keys" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_service_api_keys_hash" UNIQUE ("keyHash"),
        CONSTRAINT "FK_service_api_keys_created_by"
          FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_service_api_keys_revoked_by"
          FOREIGN KEY ("revokedBy") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_service_api_keys_consumer_created"
        ON "service_api_keys" ("consumerId", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_service_api_keys_consumer_created"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "service_api_keys"`);
  }
}
