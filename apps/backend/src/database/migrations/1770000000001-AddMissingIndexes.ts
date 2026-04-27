import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMissingIndexes1770000000001 implements MigrationInterface {
  name = 'AddMissingIndexes1770000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // stellar_accounts
    await this.createIndex(
      queryRunner,
      'stellar_accounts',
      'IDX_stellar_accounts_userId',
      ['userId'],
    );
    await this.createIndex(
      queryRunner,
      'stellar_accounts',
      'IDX_stellar_accounts_isActive',
      ['isActive'],
    );
    await this.createIndex(
      queryRunner,
      'stellar_accounts',
      'IDX_stellar_accounts_isPrimary',
      ['isPrimary'],
    );

    // articles
    await this.createIndex(queryRunner, 'articles', 'IDX_articles_category', [
      'category',
    ]);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_articles_tags_gin" ON "articles" USING GIN (tags)`,
    );

    // notifications
    await this.createIndex(
      queryRunner,
      'notifications',
      'IDX_notifications_read',
      ['read'],
    );
    await this.createIndex(
      queryRunner,
      'notifications',
      'IDX_notifications_type',
      ['type'],
    );
    await this.createIndex(
      queryRunner,
      'notifications',
      'IDX_notifications_severity',
      ['severity'],
    );
    await this.createIndex(
      queryRunner,
      'notifications',
      'IDX_notifications_createdAt',
      ['createdAt'],
    );

    // notification_delivery_logs
    await this.createIndex(
      queryRunner,
      'notification_delivery_logs',
      'IDX_notification_delivery_logs_userId_createdAt',
      ['userId', 'createdAt'],
    );
    await this.createIndex(
      queryRunner,
      'notification_delivery_logs',
      'IDX_notification_delivery_logs_status_retryCount',
      ['status', 'retryCount'],
    );

    // refresh_tokens
    await this.createIndex(
      queryRunner,
      'refresh_tokens',
      'IDX_refresh_tokens_userId',
      ['userId'],
    );
    await this.createIndex(
      queryRunner,
      'refresh_tokens',
      'IDX_refresh_tokens_expiresAt',
      ['expiresAt'],
    );

    // password_reset_tokens
    await this.createIndex(
      queryRunner,
      'password_reset_tokens',
      'IDX_password_reset_tokens_expiresAt',
      ['expiresAt'],
    );

    // push_tokens
    await this.createIndex(
      queryRunner,
      'push_tokens',
      'IDX_push_tokens_isActive',
      ['isActive'],
    );
    await this.createIndex(
      queryRunner,
      'push_tokens',
      'IDX_push_tokens_userId_isActive',
      ['userId', 'isActive'],
    );

    // outbox_events
    await this.createIndex(
      queryRunner,
      'outbox_events',
      'IDX_outbox_events_eventType',
      ['eventType'],
    );

    // daily_snapshots
    await this.createIndex(
      queryRunner,
      'daily_snapshots',
      'IDX_daily_snapshots_assetSymbol',
      ['assetSymbol'],
    );
    await this.createIndex(
      queryRunner,
      'daily_snapshots',
      'IDX_daily_snapshots_createdAt',
      ['createdAt'],
    );

    // portfolio_snapshots
    await this.createIndex(
      queryRunner,
      'portfolio_snapshots',
      'IDX_portfolio_snapshots_createdAt',
      ['createdAt'],
    );

    // stellar_sync_checkpoints
    await this.createIndex(
      queryRunner,
      'stellar_sync_checkpoints',
      'IDX_stellar_sync_checkpoints_updatedAt',
      ['updatedAt'],
    );

    // stellar_processed_events
    await this.createIndex(
      queryRunner,
      'stellar_processed_events',
      'IDX_stellar_processed_events_processedAt',
      ['processedAt'],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.dropIndex(
      queryRunner,
      'stellar_processed_events',
      'IDX_stellar_processed_events_processedAt',
    );
    await this.dropIndex(
      queryRunner,
      'stellar_sync_checkpoints',
      'IDX_stellar_sync_checkpoints_updatedAt',
    );
    await this.dropIndex(
      queryRunner,
      'portfolio_snapshots',
      'IDX_portfolio_snapshots_createdAt',
    );
    await this.dropIndex(
      queryRunner,
      'daily_snapshots',
      'IDX_daily_snapshots_createdAt',
    );
    await this.dropIndex(
      queryRunner,
      'daily_snapshots',
      'IDX_daily_snapshots_assetSymbol',
    );
    await this.dropIndex(
      queryRunner,
      'outbox_events',
      'IDX_outbox_events_eventType',
    );
    await this.dropIndex(
      queryRunner,
      'push_tokens',
      'IDX_push_tokens_userId_isActive',
    );
    await this.dropIndex(
      queryRunner,
      'push_tokens',
      'IDX_push_tokens_isActive',
    );
    await this.dropIndex(
      queryRunner,
      'password_reset_tokens',
      'IDX_password_reset_tokens_expiresAt',
    );
    await this.dropIndex(
      queryRunner,
      'refresh_tokens',
      'IDX_refresh_tokens_expiresAt',
    );
    await this.dropIndex(
      queryRunner,
      'refresh_tokens',
      'IDX_refresh_tokens_userId',
    );
    await this.dropIndex(
      queryRunner,
      'notification_delivery_logs',
      'IDX_notification_delivery_logs_status_retryCount',
    );
    await this.dropIndex(
      queryRunner,
      'notification_delivery_logs',
      'IDX_notification_delivery_logs_userId_createdAt',
    );
    await this.dropIndex(
      queryRunner,
      'notifications',
      'IDX_notifications_createdAt',
    );
    await this.dropIndex(
      queryRunner,
      'notifications',
      'IDX_notifications_severity',
    );
    await this.dropIndex(
      queryRunner,
      'notifications',
      'IDX_notifications_type',
    );
    await this.dropIndex(
      queryRunner,
      'notifications',
      'IDX_notifications_read',
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_articles_tags_gin"`,
    );
    await this.dropIndex(queryRunner, 'articles', 'IDX_articles_category');
    await this.dropIndex(
      queryRunner,
      'stellar_accounts',
      'IDX_stellar_accounts_isPrimary',
    );
    await this.dropIndex(
      queryRunner,
      'stellar_accounts',
      'IDX_stellar_accounts_isActive',
    );
    await this.dropIndex(
      queryRunner,
      'stellar_accounts',
      'IDX_stellar_accounts_userId',
    );
  }

  private async createIndex(
    queryRunner: QueryRunner,
    table: string,
    indexName: string,
    columns: string[],
  ): Promise<void> {
    const exists = (await queryRunner.query(
      `SELECT 1 FROM pg_indexes WHERE indexname = '${indexName}'`,
    )) as Array<Record<string, unknown>>;
    if (exists.length > 0) return;

    const cols = columns.map((c) => `"${c}"`).join(', ');
    await queryRunner.query(
      `CREATE INDEX "${indexName}" ON "${table}" (${cols})`,
    );
  }

  private async dropIndex(
    queryRunner: QueryRunner,
    _table: string,
    indexName: string,
  ): Promise<void> {
    const exists = (await queryRunner.query(
      `SELECT 1 FROM pg_indexes WHERE indexname = '${indexName}'`,
    )) as Array<Record<string, unknown>>;
    if (exists.length === 0) return;

    await queryRunner.query(`DROP INDEX "public"."${indexName}"`);
  }
}
