import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateProjects1775000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'projects',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '255',
            isUnique: true,
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'ownerPublicKey',
            type: 'varchar',
            length: '56',
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['ACTIVE', 'EXPIRED', 'PENDING', 'ARCHIVED'],
            default: "'PENDING'",
          },
          {
            name: 'contractAddress',
            type: 'varchar',
            length: '56',
            isNullable: true,
          },
          {
            name: 'totalFunding',
            type: 'bigint',
            isNullable: true,
          },
          {
            name: 'vaultBalance',
            type: 'bigint',
            isNullable: true,
          },
          {
            name: 'contributorCount',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'lastUpdatedLedger',
            type: 'bigint',
            isNullable: true,
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'websiteUrl',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'githubUrl',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'tags',
            type: 'text',
            isNullable: true,
            isArray: true,
          },
          {
            name: 'category',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamptz',
            default: 'now()',
          },
          {
            name: 'updatedAt',
            type: 'timestamptz',
            default: 'now()',
          },
          {
            name: 'expiresAt',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'verifiedAt',
            type: 'timestamptz',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    // Create indexes for common query patterns
    await queryRunner.createIndex(
      'projects',
      new TableIndex({
        name: 'IDX_projects_status',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'projects',
      new TableIndex({
        name: 'IDX_projects_ownerPublicKey',
        columnNames: ['ownerPublicKey'],
      }),
    );

    await queryRunner.createIndex(
      'projects',
      new TableIndex({
        name: 'IDX_projects_contractAddress',
        columnNames: ['contractAddress'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('projects', 'IDX_projects_status');
    await queryRunner.dropIndex('projects', 'IDX_projects_ownerPublicKey');
    await queryRunner.dropIndex('projects', 'IDX_projects_contractAddress');
    await queryRunner.dropTable('projects');
  }
}
