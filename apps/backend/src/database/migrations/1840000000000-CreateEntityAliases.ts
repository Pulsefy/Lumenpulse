import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `entity_aliases` table for the canonical alias registry.
 *
 * Supports project / asset / tag / category entity kinds with a unique
 * index on the lowercased alias so lookups are fast and duplicate
 * synonyms are rejected at the DB layer.
 */
export class CreateEntityAliases1840000000000 implements MigrationInterface {
  name = 'CreateEntityAliases1840000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "entity_aliases" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "entityKind" character varying(50) NOT NULL,
        "canonicalValue" character varying(255) NOT NULL,
        "alias" character varying(255) NOT NULL,
        "aliasLower" character varying(255) NOT NULL,
        "createdBy" character varying(100),
        "note" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_entity_aliases_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_entity_aliases_aliasLower"
        ON "entity_aliases" ("aliasLower")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_entity_aliases_kind_canonical"
        ON "entity_aliases" ("entityKind", "canonicalValue")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_entity_aliases_kind_canonical"`);
    await queryRunner.query(`DROP INDEX "IDX_entity_aliases_aliasLower"`);
    await queryRunner.query(`DROP TABLE "entity_aliases"`);
  }
}
