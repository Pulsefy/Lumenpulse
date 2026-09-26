import { MigrationInterface, QueryRunner } from 'typeorm';
import { MESSAGE_TEMPLATE_DEFAULTS } from '../../message-template/message-template.defaults';

export class CreateMessageTemplates1853000000000 implements MigrationInterface {
  name = 'CreateMessageTemplates1853000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "message_templates" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "key" character varying(120) NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "subjectTemplate" character varying(255),
        "titleTemplate" character varying(255),
        "messageTemplate" text,
        "bodyTemplate" text,
        "requiredVariables" jsonb NOT NULL DEFAULT '[]',
        "sampleVariables" jsonb NOT NULL DEFAULT '{}',
        "updatedBy" character varying(200),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_message_templates_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_message_templates_key" UNIQUE ("key")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "message_template_audit_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "templateKey" character varying(120) NOT NULL,
        "action" character varying(20) NOT NULL,
        "previousVersion" integer NOT NULL,
        "newVersion" integer NOT NULL,
        "previousSnapshot" jsonb NOT NULL,
        "newSnapshot" jsonb NOT NULL,
        "actor" character varying(200),
        "changedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_message_template_audit_logs_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_message_templates_key" ON "message_templates" ("key")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_message_template_audit_logs_templateKey" ON "message_template_audit_logs" ("templateKey")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_message_template_audit_logs_actor" ON "message_template_audit_logs" ("actor")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_message_template_audit_logs_changedAt" ON "message_template_audit_logs" ("changedAt")`,
    );

    for (const definition of MESSAGE_TEMPLATE_DEFAULTS) {
      await queryRunner.query(
        `
        INSERT INTO "message_templates" (
          "key",
          "version",
          "subjectTemplate",
          "titleTemplate",
          "messageTemplate",
          "bodyTemplate",
          "requiredVariables",
          "sampleVariables"
        ) VALUES ($1, 1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
      `,
        [
          definition.key,
          definition.subjectTemplate,
          definition.titleTemplate,
          definition.messageTemplate,
          definition.bodyTemplate,
          JSON.stringify(definition.requiredVariables),
          JSON.stringify(definition.sampleVariables),
        ],
      );

      const snapshot = {
        subjectTemplate: definition.subjectTemplate,
        titleTemplate: definition.titleTemplate,
        messageTemplate: definition.messageTemplate,
        bodyTemplate: definition.bodyTemplate,
        requiredVariables: definition.requiredVariables,
        sampleVariables: definition.sampleVariables,
        version: 1,
      };

      await queryRunner.query(
        `
        INSERT INTO "message_template_audit_logs" (
          "templateKey",
          "action",
          "previousVersion",
          "newVersion",
          "previousSnapshot",
          "newSnapshot",
          "actor"
        ) VALUES ($1, 'create', 0, 1, '{}'::jsonb, $2::jsonb, 'migration')
      `,
        [definition.key, JSON.stringify(snapshot)],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_message_template_audit_logs_changedAt"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_message_template_audit_logs_actor"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_message_template_audit_logs_templateKey"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "message_template_audit_logs"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_message_templates_key"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "message_templates"`);
  }
}
