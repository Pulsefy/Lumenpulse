import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Wave 9: Audit database indexes against hot queries (#1422).
 *
 * @acknowledge-destructive
 * Removes 19 duplicate and redundant left-prefix indexes accumulated across
 * previous waves to eliminate write amplification and index bloat.
 * Adds 8 targeted indexes for hot queries identified across representative workloads:
 * - Watchlist symbol matching during notification fanout
 * - Unscored articles polling for sentiment analysis
 * - News category filtering
 * - Notification feeds and unread badge queries
 * - Stellar account primary lookup
 * - Crowdfund vault event reorg and sequence verification
 * - Moderation content reports status queue
 * - Read-model rebuild deduplication
 */
export class AuditAndOptimizeDatabaseIndexes1852000000000 implements MigrationInterface {
  name = 'AuditAndOptimizeDatabaseIndexes1852000000000';
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // -------------------------------------------------------------------------
    // 1. ADD MISSING INDEXES FOR HOT QUERIES
    // -------------------------------------------------------------------------

    // Q1: Watchlist symbol matching during notification fanout
    // Serves: NotificationFanoutService.findTargetUsersForWatchlist
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_watchlist_items_symbol_type_userId"
        ON "watchlist_items" ("symbol", "type", "userId")
    `);

    // Q2: Polling for unscored news articles
    // Serves: NewsService.findUnscoredArticles / sentiment worker
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_articles_unscored_published"
        ON "articles" ("publishedAt" DESC)
        WHERE "sentimentScore" IS NULL
    `);

    // Q3: News category filtering
    // Serves: NewsService.findAll
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_articles_category_published"
        ON "articles" (LOWER("category"::text), "publishedAt" DESC)
    `);

    // Q4: User notification feed and unread counter
    // Serves: NotificationService.findForUser
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_notifications_user_read_created"
        ON "notifications" ("userId", "read", "createdAt" DESC)
    `);

    // Q5: Stellar primary account lookup
    // Serves: UsersService.findPrimaryStellarAccount
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_stellar_accounts_user_primary"
        ON "stellar_accounts" ("userId", "isPrimary")
    `);

    // Q6: Crowdfund vault events reorg and sequence detection
    // Serves: CrowdfundSyncService.detectReorgs
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_crowdfund_vault_events_vault_status_ledger"
        ON "crowdfund_vault_events" ("vault_address", "status", "ledger_sequence" DESC)
    `);

    // Q7: Moderation content reports status queue
    // Serves: ModerationService.getReports
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_content_reports_status_created"
        ON "content_reports" ("status", "created_at" DESC)
    `);

    // Q8: Read model rebuild job deduplication
    // Serves: ReadModelRebuildService.findExistingJob
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_rebuild_jobs_dataset_created_status"
        ON "read_model_rebuild_jobs" ("dataset", "createdAt" DESC, "status")
    `);

    // -------------------------------------------------------------------------
    // 2. REMOVE UNUSED & DUPLICATE INDEXES
    // -------------------------------------------------------------------------

    // Duplicate unique index on users(email) - UQ_97672ac88f789774dd47f7c8be3 covers this
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_97672ac88f789774dd47f7c8be"`,
    );

    // Duplicate unique index on project_registry(projectId) - UQ_project_registry_projectId covers this
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_project_registry_projectId"`,
    );

    // Duplicate non-unique index on telegram_silence(chatId) - UQ_telegram_silence_chatId covers this
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_telegram_silence_chatId"`,
    );

    // Duplicate non-unique index on telegram_subscriptions(chatId) - UQ_telegram_subscriptions_chatId covers this
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_telegram_subscriptions_chatId"`,
    );

    // Duplicate non-unique index on notification_preferences(userId) - UQ_notification_preferences_user covers this
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_notification_preferences_userId"`,
    );

    // Redundant prefix index on portfolio_assets(userId) - covered by IDX_portfolio_assets_userId_assetCode
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_portfolio_assets_userId"`,
    );

    // Redundant prefix index on articles(source) - covered by IDX_articles_source_publishedAt
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_articles_source"`,
    );

    // Redundant prefix index on notification_delivery_logs(userId) - covered by IDX_notification_delivery_logs_user_created
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_notification_delivery_logs_userId"`,
    );

    // Redundant prefix index on notification_suppression_logs(userId) - covered by IDX_notification_suppression_logs_user_event
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_notification_suppression_logs_userId"`,
    );

    // Redundant prefix index on notifications(userId) - covered by IDX_notifications_user_created
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_notifications_userId"`,
    );

    // Redundant index on portfolio_snapshots(userId, createdAt) - covered by IDX_portfolio_snapshots_user_created_at_desc
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_portfolio_snapshots_userId_createdAt"`,
    );

    // Redundant prefix index on push_tokens(userId) - covered by IDX_push_tokens_user_active
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_push_tokens_userId"`,
    );

    // Redundant prefix index on refresh_tokens(userId) - covered by IDX_refresh_tokens_userId_revokedAt
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_refresh_tokens_userId"`,
    );

    // Redundant prefix index on soroban_event_dead_letter(status) - covered by IDX_dlq_status_created_at
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_dlq_status"`);

    // Redundant prefix index on soroban_events(status) - covered by IDX_soroban_events_status_created_at
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_soroban_events_status"`,
    );

    // Redundant prefix index on stellar_accounts(userId) - covered by UQ_stellar_accounts_user_publicKey
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_stellar_accounts_userId"`,
    );

    // Redundant prefix index on crowdfund_vault_dead_letter(vault_address) - covered by IDX_crowdfund_vault_dead_letter_vault_event_type
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_crowdfund_vault_dead_letter_vault_address"`,
    );

    // Redundant prefix index on crowdfund_vault_events(vault_address) - covered by IDX_crowdfund_vault_events_vault_ledger
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_crowdfund_vault_events_vault_address"`,
    );

    // Redundant prefix index on watchlist_items(userId) - covered by IDX_watchlist_items_user_symbol_type
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_watchlist_items_userId"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // -------------------------------------------------------------------------
    // 1. RE-CREATE DROPPED INDEXES (RESTORE HISTORICAL STATE)
    // Note: Reversion runs within migration rollback transaction, so standard
    // DDL statements (without CONCURRENTLY) are used.
    // -------------------------------------------------------------------------
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_watchlist_items_userId"
        ON "watchlist_items" ("userId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_crowdfund_vault_events_vault_address"
        ON "crowdfund_vault_events" ("vault_address")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_crowdfund_vault_dead_letter_vault_address"
        ON "crowdfund_vault_dead_letter" ("vault_address")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_stellar_accounts_userId"
        ON "stellar_accounts" ("userId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_soroban_events_status"
        ON "soroban_events" ("status")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_dlq_status"
        ON "soroban_event_dead_letter" ("status")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_refresh_tokens_userId"
        ON "refresh_tokens" ("userId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_push_tokens_userId"
        ON "push_tokens" ("userId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_portfolio_snapshots_userId_createdAt"
        ON "portfolio_snapshots" ("userId", "createdAt")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_notifications_userId"
        ON "notifications" ("userId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_notification_suppression_logs_userId"
        ON "notification_suppression_logs" ("userId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_notification_delivery_logs_userId"
        ON "notification_delivery_logs" ("userId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_articles_source"
        ON "articles" ("source")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_portfolio_assets_userId"
        ON "portfolio_assets" ("userId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_notification_preferences_userId"
        ON "notification_preferences" ("userId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_telegram_subscriptions_chatId"
        ON "telegram_subscriptions" ("chatId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_telegram_silence_chatId"
        ON "telegram_silence" ("chatId")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_project_registry_projectId"
        ON "project_registry" ("projectId")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_97672ac88f789774dd47f7c8be"
        ON "users" ("email")
    `);

    // -------------------------------------------------------------------------
    // 2. DROP ADDED OPTIMIZED INDEXES
    // -------------------------------------------------------------------------
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_rebuild_jobs_dataset_created_status"`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_content_reports_status_created"`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_crowdfund_vault_events_vault_status_ledger"`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_stellar_accounts_user_primary"`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_notifications_user_read_created"`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_articles_category_published"`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_articles_unscored_published"`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_watchlist_items_symbol_type_userId"`,
    );
  }
}
