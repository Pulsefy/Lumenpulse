import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePriceAlertRules1810000000000 implements MigrationInterface {
  name = 'CreatePriceAlertRules1810000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "price_alert_condition_enum" AS ENUM ('above', 'below')`,
    );

    await queryRunner.query(`
      CREATE TABLE "price_alert_rules" (
        "id"               uuid                            NOT NULL DEFAULT uuid_generate_v4(),
        "userId"           uuid                            NOT NULL,
        "symbol"           character varying(50)           NOT NULL,
        "targetPrice"      numeric(20,8)                   NOT NULL,
        "condition"        "price_alert_condition_enum"    NOT NULL DEFAULT 'above',
        "isActive"         boolean                         NOT NULL DEFAULT true,
        "cooldownMinutes"  integer                         NOT NULL DEFAULT 60,
        "lastTriggeredAt"  TIMESTAMP WITH TIME ZONE,
        "createdAt"        TIMESTAMP WITH TIME ZONE        NOT NULL DEFAULT now(),
        "updatedAt"        TIMESTAMP WITH TIME ZONE        NOT NULL DEFAULT now(),
        CONSTRAINT "PK_price_alert_rules" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_price_alert_rules_user_symbol" ON "price_alert_rules" ("userId", "symbol")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_price_alert_rules_is_active" ON "price_alert_rules" ("isActive")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_price_alert_rules_symbol_active" ON "price_alert_rules" ("symbol", "isActive")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_price_alert_rules_symbol_active"`);
    await queryRunner.query(`DROP INDEX "IDX_price_alert_rules_is_active"`);
    await queryRunner.query(`DROP INDEX "IDX_price_alert_rules_user_symbol"`);
    await queryRunner.query(`DROP TABLE "price_alert_rules"`);
    await queryRunner.query(`DROP TYPE "price_alert_condition_enum"`);
  }
}
