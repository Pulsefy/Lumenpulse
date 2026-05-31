import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProjectRegistry1780139556474 implements MigrationInterface {
  name = 'CreateProjectRegistry1780139556474';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ONLY create the project_registry table
    await queryRunner.query(`
            CREATE TABLE "project_registry" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(), 
                "projectId" character varying NOT NULL, 
                "owner" character varying NOT NULL, 
                "name" character varying NOT NULL, 
                "metadataCid" character varying, 
                "status" character varying NOT NULL DEFAULT 'active', 
                "lastLedgerSeq" integer NOT NULL, 
                "lastTxHash" character varying NOT NULL, 
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(), 
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), 
                CONSTRAINT "UQ_project_registry_projectId" UNIQUE ("projectId"), 
                CONSTRAINT "PK_project_registry" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_project_registry_projectId" ON "project_registry" ("projectId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ONLY drop the project_registry table
    await queryRunner.query(
      `DROP INDEX "public"."IDX_project_registry_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "project_registry"`);
  }
}
