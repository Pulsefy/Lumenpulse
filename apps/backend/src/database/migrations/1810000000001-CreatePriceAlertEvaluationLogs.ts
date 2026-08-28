import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePriceAlertEvaluationLogs1810000000001 implements MigrationInterface {
  name = 'CreatePriceAlertEvaluationLogs1810000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "price_alert_evaluation_logs" (
        "id"               uuid                            NOT NULL DEFAULT uuid_generate_v4(),
        "ruleId"           uuid                            NOT NULL,
        "userId"           uuid                            NOT NULL,
        "symbol"           character varying(50)           NOT NULL,
        "currentPrice"     numeric(20,8)                   NOT NULL,
        "targetPrice"      numeric(20,8)                   NOT NULL,
        "condition"        "price_alert_condition_enum"    NOT NULL,
        "triggered"        boolean                         NOT NULL DEFAULT false,
        "suppressedReason" character varying(100),
        "notificationId"   uuid,
        "evaluatedAt"      TIMESTAMP WITH TIME ZONE        NOT NULL DEFAULT now(),
        CONSTRAINT "PK_price_alert_evaluation_logs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_price_alert_eval_logs_rule_evaluated" ON "price_alert_evaluation_logs" ("ruleId", "evaluatedAt" DESC)`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_price_alert_eval_logs_triggered" ON "price_alert_evaluation_logs" ("triggered")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_price_alert_eval_logs_triggered"`);
    await queryRunner.query(
      `DROP INDEX "IDX_price_alert_eval_logs_rule_evaluated"`,
    );
    await queryRunner.query(`DROP TABLE "price_alert_evaluation_logs"`);
  }
}
