import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateReadModelRebuildJobs1820000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'read_model_rebuild_jobs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'dataset',
            type: 'enum',
            enum: [
              'kpi_snapshots',
              'project_views',
              'contract_events',
              'daily_metrics',
              'all',
            ],
            isNullable: false,
          },
          {
            name: 'contract_id',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'status',
            type: 'enum',
            enum: [
              'pending',
              'in_progress',
              'completed',
              'failed',
              'cancelled',
            ],
            default: "'pending'",
          },
          {
            name: 'trigger_reason',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'triggered_by',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'total_items',
            type: 'int',
            default: 0,
          },
          {
            name: 'processed_items',
            type: 'int',
            default: 0,
          },
          {
            name: 'failed_items',
            type: 'int',
            default: 0,
          },
          {
            name: 'progress_details',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'error_message',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'error_stack',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'started_at',
            type: 'timestamp with time zone',
            isNullable: true,
          },
          {
            name: 'completed_at',
            type: 'timestamp with time zone',
            isNullable: true,
          },
          {
            name: 'idempotency_key',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'rebuild_version',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp with time zone',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp with time zone',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Create indexes
    await queryRunner.createIndex(
      'read_model_rebuild_jobs',
      new TableIndex({
        name: 'idx_rebuild_jobs_status_created',
        columnNames: ['status', 'created_at'],
      }),
    );

    await queryRunner.createIndex(
      'read_model_rebuild_jobs',
      new TableIndex({
        name: 'idx_rebuild_jobs_dataset_status',
        columnNames: ['dataset', 'status'],
      }),
    );

    await queryRunner.createIndex(
      'read_model_rebuild_jobs',
      new TableIndex({
        name: 'idx_rebuild_jobs_contract_status',
        columnNames: ['contract_id', 'status'],
      }),
    );

    await queryRunner.createIndex(
      'read_model_rebuild_jobs',
      new TableIndex({
        name: 'idx_rebuild_jobs_idempotency_key',
        columnNames: ['idempotency_key'],
        isUnique: true,
        where: '"idempotency_key" IS NOT NULL',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'read_model_rebuild_jobs',
      'idx_rebuild_jobs_idempotency_key',
    );
    await queryRunner.dropIndex(
      'read_model_rebuild_jobs',
      'idx_rebuild_jobs_contract_status',
    );
    await queryRunner.dropIndex(
      'read_model_rebuild_jobs',
      'idx_rebuild_jobs_dataset_status',
    );
    await queryRunner.dropIndex(
      'read_model_rebuild_jobs',
      'idx_rebuild_jobs_status_created',
    );
    await queryRunner.dropTable('read_model_rebuild_jobs');
  }
}
