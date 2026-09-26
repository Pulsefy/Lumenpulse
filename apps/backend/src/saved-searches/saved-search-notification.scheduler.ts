import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SavedSearchesService } from './saved-searches.service';
import { GrantsService } from '../grants/grants.service';
import { NewsService } from '../news/news.service';
import { ProjectsService } from '../projects/projects.service';
import {
  ProjectListQueryDto,
  ProjectListItemDto,
  ProjectStatus,
} from '../projects/dto/projects.dto';
import { News } from '../news/news.entity';
import {
  SavedSearch,
  SavedSearchDomain,
} from './entities/saved-search.entity';

/**
 * Periodically re-executes every subscribed saved search and notifies users
 * when there are results newer than the last notification.
 *
 * Design notes:
 *  - Runs every 30 minutes (EVERY_30_MINUTES cron).
 *  - Each domain delegates to its native service with the saved `filters`.
 *  - "New" means created/published after `lastNotifiedAt` (null → all results
 *    on first run, so the first notification counts everything).
 *  - Errors on individual searches are caught and logged; they do not abort
 *    the rest of the batch.
 */
@Injectable()
export class SavedSearchNotificationScheduler {
  private readonly logger = new Logger(SavedSearchNotificationScheduler.name);

  constructor(
    private readonly savedSearchesService: SavedSearchesService,
    private readonly grantsService: GrantsService,
    private readonly newsService: NewsService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async processSubscribedSearches(): Promise<void> {
    this.logger.log('Running saved-search subscription check…');

    let subscribed: SavedSearch[];
    try {
      subscribed = await this.savedSearchesService.findAllSubscribed();
    } catch (err) {
      this.logger.error('Failed to load subscribed saved searches', err);
      return;
    }

    this.logger.log(`Processing ${subscribed.length} subscribed searches`);

    for (const search of subscribed) {
      try {
        await this.processOne(search);
      } catch (err) {
        this.logger.error(
          `Error processing saved search id=${search.id}: ${(err as Error).message}`,
          (err as Error).stack,
        );
      }
    }

    this.logger.log('Saved-search subscription check complete');
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async processOne(search: SavedSearch): Promise<void> {
    const since: Date | null = search.lastNotifiedAt;
    const newCount = await this.countNewResults(search, since);

    if (newCount > 0) {
      await this.savedSearchesService.dispatchNewResultsNotification(
        search,
        newCount,
      );
    }
  }

  private async countNewResults(
    search: SavedSearch,
    since: Date | null,
  ): Promise<number> {
    switch (search.domain) {
      case SavedSearchDomain.GRANTS:
        return this.countNewGrantResults(search.filters, since);
      case SavedSearchDomain.PROJECTS:
        return this.countNewProjectResults(search.filters, since);
      case SavedSearchDomain.NEWS:
        return this.countNewNewsResults(search.filters, since);
    }
  }

  /**
   * Counts active grant rounds whose startTime is after `since`.
   * GrantsService is in-memory; a production implementation would query the DB.
   */
  private countNewGrantResults(
    _filters: Record<string, unknown>,
    since: Date | null,
  ): number {
    const rounds = this.grantsService.listRounds() as Array<{
      startTime: number;
    }>;

    if (!since) return rounds.length;

    return rounds.filter((r) => r.startTime * 1000 > since.getTime()).length;
  }

  /**
   * Counts projects created after `since` by delegating to listProjects with
   * the same query parameters stored in `filters`.
   */
  private async countNewProjectResults(
    filters: Record<string, unknown>,
    since: Date | null,
  ): Promise<number> {
    // Build a fully-typed query DTO — no `as any` cast needed.
    const query = new ProjectListQueryDto();
    query.page = 1;
    query.limit = 100;

    if (
      typeof filters['status'] === 'string' &&
      Object.values(ProjectStatus).includes(filters['status'] as ProjectStatus)
    ) {
      query.status = filters['status'] as ProjectStatus;
    }

    if (typeof filters['owner'] === 'string') {
      query.owner = filters['owner'];
    }

    const response = await this.projectsService.listProjects(query);

    if (!since) return response.total;

    // ProjectListResponseDto uses `projects`, typed as ProjectListItemDto[].
    return response.projects.filter((p: ProjectListItemDto) => {
      return new Date(p.createdAt).getTime() > since.getTime();
    }).length;
  }

  /**
   * Counts news articles published after `since` by delegating to NewsService.
   */
  private async countNewNewsResults(
    filters: Record<string, unknown>,
    since: Date | null,
  ): Promise<number> {
    const articles: News[] = await this.newsService.findAll({
      tag: typeof filters['tag'] === 'string' ? filters['tag'] : undefined,
      category:
        typeof filters['category'] === 'string'
          ? filters['category']
          : undefined,
    });

    if (!since) return articles.length;

    return articles.filter(
      (a: News) => new Date(a.publishedAt).getTime() > since.getTime(),
    ).length;
  }
}
