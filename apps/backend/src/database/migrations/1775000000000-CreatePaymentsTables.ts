import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePaymentsTables1775000000000 implements MigrationInterface {
  name = 'CreatePaymentsTables1775000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE payment_link_status AS ENUM ('active', 'inactive', 'expired', 'completed');
      CREATE TYPE payment_transaction_status AS ENUM ('pending', 'success', 'failed');

      CREATE TABLE payment_links (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL,
        link_id varchar(100) NOT NULL,
        title varchar(255) NOT NULL,
        description text,
        token_address varchar(255) NOT NULL,
        amount bigint NOT NULL,
        currency varchar(100),
        recipient varchar(255),
        status payment_link_status NOT NULL DEFAULT 'active',
        expires_at timestamptz,
        completed_at timestamptz,
        metadata jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE UNIQUE INDEX "UQ_payment_links_org_link" ON payment_links (organization_id, link_id);
      CREATE INDEX "IDX_payment_links_org_status" ON payment_links (organization_id, status);
      CREATE INDEX "IDX_payment_links_status_created" ON payment_links (status, created_at);
      CREATE INDEX "IDX_payment_links_expires" ON payment_links (expires_at);

      CREATE TABLE idempotency_keys (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key varchar(255) NOT NULL,
        organization_id uuid NOT NULL,
        payment_link_id uuid,
        transaction_hash varchar(128),
        result varchar(50),
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE UNIQUE INDEX "UQ_idempotency_keys_key" ON idempotency_keys (key);
      CREATE INDEX "IDX_idempotency_keys_org" ON idempotency_keys (organization_id);
      CREATE INDEX "IDX_idempotency_keys_created" ON idempotency_keys (created_at);

      CREATE TABLE payment_transactions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        payment_link_id uuid NOT NULL,
        organization_id uuid NOT NULL,
        transaction_hash varchar(128) NOT NULL,
        sender_public_key varchar(128) NOT NULL,
        receiver_public_key varchar(128) NOT NULL,
        token_address varchar(255),
        amount bigint NOT NULL,
        fee bigint NOT NULL,
        status payment_transaction_status NOT NULL DEFAULT 'pending',
        settled_at timestamptz,
        error_message text,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX "IDX_payment_transactions_link" ON payment_transactions (payment_link_id);
      CREATE INDEX "IDX_payment_transactions_org" ON payment_transactions (organization_id);
      CREATE UNIQUE INDEX "UQ_payment_transactions_hash" ON payment_transactions (transaction_hash);
      CREATE INDEX "IDX_payment_transactions_sender" ON payment_transactions (sender_public_key);
      CREATE INDEX "IDX_payment_transactions_receiver" ON payment_transactions (receiver_public_key);
      CREATE INDEX "IDX_payment_transactions_created" ON payment_transactions (created_at);
      CREATE INDEX "IDX_payment_transactions_status" ON payment_transactions (status);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_payment_transactions_status" ON payment_transactions;
      DROP INDEX IF EXISTS "IDX_payment_transactions_created" ON payment_transactions;
      DROP INDEX IF EXISTS "IDX_payment_transactions_receiver" ON payment_transactions;
      DROP INDEX IF EXISTS "IDX_payment_transactions_sender" ON payment_transactions;
      DROP INDEX IF EXISTS "UQ_payment_transactions_hash" ON payment_transactions;
      DROP INDEX IF EXISTS "IDX_payment_transactions_org" ON payment_transactions;
      DROP INDEX IF EXISTS "IDX_payment_transactions_link" ON payment_transactions;
      DROP TABLE IF EXISTS payment_transactions;

      DROP INDEX IF EXISTS "IDX_idempotency_keys_created" ON idempotency_keys;
      DROP INDEX IF EXISTS "IDX_idempotency_keys_org" ON idempotency_keys;
      DROP INDEX IF EXISTS "UQ_idempotency_keys_key" ON idempotency_keys;
      DROP TABLE IF EXISTS idempotency_keys;

      DROP INDEX IF EXISTS "IDX_payment_links_expires" ON payment_links;
      DROP INDEX IF EXISTS "IDX_payment_links_status_created" ON payment_links;
      DROP INDEX IF EXISTS "IDX_payment_links_org_status" ON payment_links;
      DROP INDEX IF EXISTS "UQ_payment_links_org_link" ON payment_links;
      DROP TABLE IF EXISTS payment_links;

      DROP TYPE IF EXISTS payment_transaction_status;
      DROP TYPE IF EXISTS payment_link_status;
    `);
  }
}