import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

export class CreateProjectSubmissionTables1713868800000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create project_submissions table
    await queryRunner.createTable(
      new Table({
        name: 'project_submissions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          {
            name: 'creatorId',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'title',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'description',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'detailedContent',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'projectType',
            type: 'enum',
            enum: [
              'news_aggregator',
              'portfolio_tracker',
              'trading_bot',
              'defi_protocol',
              'educational',
              'other',
            ],
            default: "'other'",
          },
          {
            name: 'status',
            type: 'enum',
            enum: [
              'draft',
              'under_review',
              'changes_requested',
              'approved',
              'rejected',
              'published',
            ],
            default: "'draft'",
          },
          {
            name: 'repositoryUrl',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'liveUrl',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'metadata',
            type: 'json',
            isNullable: true,
          },
          {
            name: 'reviewedById',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'submittedAt',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'publishedAt',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'rejectedAt',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'version',
            type: 'int',
            default: 0,
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'deletedAt',
            type: 'timestamp',
            isNullable: true,
          },
        ],
      }),
    );

    // Add foreign key for creatorId
    await queryRunner.createForeignKey(
      'project_submissions',
      new TableForeignKey({
        columnNames: ['creatorId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      }),
    );

    // Add foreign key for reviewedById
    await queryRunner.createForeignKey(
      'project_submissions',
      new TableForeignKey({
        columnNames: ['reviewedById'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'SET NULL',
      }),
    );

    // Add indexes
    await queryRunner.createIndex(
      'project_submissions',
      new TableIndex({
        name: 'IDX_project_submissions_creatorId',
        columnNames: ['creatorId'],
      }),
    );

    await queryRunner.createIndex(
      'project_submissions',
      new TableIndex({
        name: 'IDX_project_submissions_status',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'project_submissions',
      new TableIndex({
        name: 'IDX_project_submissions_createdAt',
        columnNames: ['createdAt'],
      }),
    );

    await queryRunner.createIndex(
      'project_submissions',
      new TableIndex({
        name: 'IDX_project_submissions_creatorId_status',
        columnNames: ['creatorId', 'status'],
      }),
    );

    // Create review_feedback table
    await queryRunner.createTable(
      new Table({
        name: 'review_feedback',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          {
            name: 'submissionId',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'reviewerId',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'type',
            type: 'enum',
            enum: ['comment', 'request_changes', 'approval', 'rejection'],
          },
          {
            name: 'message',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'suggestions',
            type: 'json',
            isNullable: true,
          },
          {
            name: 'isResolved',
            type: 'boolean',
            default: false,
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
    );

    // Add foreign keys for review_feedback
    await queryRunner.createForeignKey(
      'review_feedback',
      new TableForeignKey({
        columnNames: ['submissionId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'project_submissions',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'review_feedback',
      new TableForeignKey({
        columnNames: ['reviewerId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      }),
    );

    // Add indexes for review_feedback
    await queryRunner.createIndex(
      'review_feedback',
      new TableIndex({
        name: 'IDX_review_feedback_submissionId',
        columnNames: ['submissionId'],
      }),
    );

    await queryRunner.createIndex(
      'review_feedback',
      new TableIndex({
        name: 'IDX_review_feedback_reviewerId',
        columnNames: ['reviewerId'],
      }),
    );

    await queryRunner.createIndex(
      'review_feedback',
      new TableIndex({
        name: 'IDX_review_feedback_createdAt',
        columnNames: ['createdAt'],
      }),
    );

    await queryRunner.createIndex(
      'review_feedback',
      new TableIndex({
        name: 'IDX_review_feedback_submissionId_reviewerId',
        columnNames: ['submissionId', 'reviewerId'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop review_feedback table
    await queryRunner.dropIndex('review_feedback', 'IDX_review_feedback_submissionId_reviewerId');
    await queryRunner.dropIndex('review_feedback', 'IDX_review_feedback_createdAt');
    await queryRunner.dropIndex('review_feedback', 'IDX_review_feedback_reviewerId');
    await queryRunner.dropIndex('review_feedback', 'IDX_review_feedback_submissionId');

    const reviewFeedbackTable = await queryRunner.getTable('review_feedback');
    const reviewFeedbackFks = reviewFeedbackTable?.foreignKeys;

    if (reviewFeedbackFks) {
      for (const fk of reviewFeedbackFks) {
        await queryRunner.dropForeignKey('review_feedback', fk);
      }
    }

    await queryRunner.dropTable('review_feedback');

    // Drop project_submissions table
    await queryRunner.dropIndex(
      'project_submissions',
      'IDX_project_submissions_creatorId_status',
    );
    await queryRunner.dropIndex(
      'project_submissions',
      'IDX_project_submissions_createdAt',
    );
    await queryRunner.dropIndex('project_submissions', 'IDX_project_submissions_status');
    await queryRunner.dropIndex('project_submissions', 'IDX_project_submissions_creatorId');

    const projectSubmissionsTable = await queryRunner.getTable('project_submissions');
    const projectSubmissionsFks = projectSubmissionsTable?.foreignKeys;

    if (projectSubmissionsFks) {
      for (const fk of projectSubmissionsFks) {
        await queryRunner.dropForeignKey('project_submissions', fk);
      }
    }

    await queryRunner.dropTable('project_submissions');
  }
}
