import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOutboundWebhooks1865000000000 implements MigrationInterface {
  name = 'CreateOutboundWebhooks1865000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create webhook_subscriptions table
    await queryRunner.query(`
      CREATE TABLE "webhook_subscriptions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "partnerId" character varying(120),
        "name" character varying(255) NOT NULL,
        "targetUrl" character varying(1024) NOT NULL,
        "eventTypes" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "status" character varying(50) NOT NULL DEFAULT 'ACTIVE',
        "secret" character varying(512) NOT NULL,
        "secretId" character varying(64) NOT NULL,
        "previousSecret" character varying(512),
        "previousSecretId" character varying(64),
        "overlapExpiresAt" TIMESTAMP WITH TIME ZONE,
        "secretVersion" integer NOT NULL DEFAULT 1,
        "metadata" jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_webhook_subscriptions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_webhook_subscriptions_partner"
        ON "webhook_subscriptions" ("partnerId")
    `);

    // 2. Create webhook_deliveries table
    await queryRunner.query(`
      CREATE TABLE "webhook_deliveries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "subscriptionId" uuid NOT NULL,
        "eventType" character varying(120) NOT NULL,
        "payload" jsonb NOT NULL,
        "status" character varying(50) NOT NULL DEFAULT 'PENDING',
        "attempts" integer NOT NULL DEFAULT 0,
        "maxAttempts" integer NOT NULL DEFAULT 5,
        "nextRetryAt" TIMESTAMP WITH TIME ZONE,
        "responseStatusCode" integer,
        "responseBody" text,
        "lastError" text,
        "requestHeaders" jsonb,
        "executionDurationMs" integer,
        "deliveredAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_webhook_deliveries" PRIMARY KEY ("id"),
        CONSTRAINT "FK_webhook_deliveries_subscription"
          FOREIGN KEY ("subscriptionId") REFERENCES "webhook_subscriptions"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_webhook_deliveries_sub_created"
        ON "webhook_deliveries" ("subscriptionId", "createdAt")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_webhook_deliveries_status_next_retry"
        ON "webhook_deliveries" ("status", "nextRetryAt")
    `);

    // 3. Create webhook_dead_letter table
    await queryRunner.query(`
      CREATE TABLE "webhook_dead_letter" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "deliveryId" uuid NOT NULL,
        "subscriptionId" uuid NOT NULL,
        "eventType" character varying(120) NOT NULL,
        "payload" jsonb NOT NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "lastErrorMessage" text,
        "errorHistory" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "status" character varying(50) NOT NULL DEFAULT 'pending',
        "maintainerNotes" text,
        "resolvedBy" character varying(200),
        "resolvedAt" TIMESTAMP WITH TIME ZONE,
        "replayedAt" TIMESTAMP WITH TIME ZONE,
        "replayCount" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_webhook_dead_letter" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_webhook_dead_letter_delivery_id" UNIQUE ("deliveryId")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_webhook_dead_letter_sub_status"
        ON "webhook_dead_letter" ("subscriptionId", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_webhook_dead_letter_created"
        ON "webhook_dead_letter" ("createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_webhook_dead_letter_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_webhook_dead_letter_sub_status"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "webhook_dead_letter"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_webhook_deliveries_status_next_retry"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_webhook_deliveries_sub_created"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "webhook_deliveries"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_webhook_subscriptions_partner"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "webhook_subscriptions"`);
  }
}
