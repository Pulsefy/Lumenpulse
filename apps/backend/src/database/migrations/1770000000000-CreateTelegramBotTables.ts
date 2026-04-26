import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTelegramBotTables1770000000000 implements MigrationInterface {
  name = 'CreateTelegramBotTables1770000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const subscriptionsTableExists = await queryRunner.hasTable('telegram_subscriptions');
    if (!subscriptionsTableExists) {
      await queryRunner.query(`
        CREATE TABLE "telegram_subscriptions" (
          "id"         uuid NOT NULL DEFAULT uuid_generate_v4(),
          "chatId"     character varying(50) NOT NULL,
          "username"   character varying(100) DEFAULT NULL,
          "alertTypes" jsonb NOT NULL DEFAULT '["price", "sentiment", "news"]',
          "isActive"   boolean NOT NULL DEFAULT true,
          "createdAt"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          "updatedAt"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          CONSTRAINT "PK_telegram_subscriptions" PRIMARY KEY ("id"),
          CONSTRAINT "UQ_telegram_subscriptions_chatId" UNIQUE ("chatId")
        )
      `);
      await queryRunner.query(
        `CREATE INDEX "IDX_telegram_subscriptions_chatId" ON "telegram_subscriptions" ("chatId")`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_telegram_subscriptions_isActive" ON "telegram_subscriptions" ("isActive")`,
      );
    }

    const silenceTableExists = await queryRunner.hasTable('telegram_silence');
    if (!silenceTableExists) {
      await queryRunner.query(`
        CREATE TABLE "telegram_silence" (
          "id"            uuid NOT NULL DEFAULT uuid_generate_v4(),
          "chatId"        character varying(50) NOT NULL,
          "silencedUntil" TIMESTAMP WITH TIME ZONE NOT NULL,
          "createdAt"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          CONSTRAINT "PK_telegram_silence" PRIMARY KEY ("id"),
          CONSTRAINT "UQ_telegram_silence_chatId" UNIQUE ("chatId")
        )
      `);
      await queryRunner.query(
        `CREATE INDEX "IDX_telegram_silence_chatId" ON "telegram_silence" ("chatId")`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_telegram_silence_silencedUntil" ON "telegram_silence" ("silencedUntil")`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const silenceTableExists = await queryRunner.hasTable('telegram_silence');
    if (silenceTableExists) {
      await queryRunner.query(`DROP INDEX "public"."IDX_telegram_silence_silencedUntil"`);
      await queryRunner.query(`DROP INDEX "public"."IDX_telegram_silence_chatId"`);
      await queryRunner.query(`DROP TABLE "telegram_silence"`);
    }

    const subscriptionsTableExists = await queryRunner.hasTable('telegram_subscriptions');
    if (subscriptionsTableExists) {
      await queryRunner.query(`DROP INDEX "public"."IDX_telegram_subscriptions_isActive"`);
      await queryRunner.query(`DROP INDEX "public"."IDX_telegram_subscriptions_chatId"`);
      await queryRunner.query(`DROP TABLE "telegram_subscriptions"`);
    }
  }
}
