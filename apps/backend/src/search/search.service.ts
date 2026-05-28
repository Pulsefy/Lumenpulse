import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { News } from '../news/news.entity';
import { StellarService } from '../stellar/stellar.service';
import { AssetDto } from '../stellar/dto/asset-discovery.dto';
import { VerificationService } from '../verification/verification.service';
import { ProjectVerificationDto } from '../verification/dto/verification.dto';
import { AssetSearchQueryDto } from './dto/asset-search.dto';
import {
  ProjectSearchItemDto,
  ProjectSearchQueryDto,
  ProjectSearchResponseDto,
} from './dto/project-search.dto';
import {
  EcosystemEntityDto,
  EcosystemSearchQueryDto,
  EcosystemSearchResponseDto,
} from './dto/ecosystem-search.dto';
import {
  EntityLinkingQueryDto,
  EntityLinkingResponseDto,
} from './dto/entity-linking.dto';

type TagRow = { value: string; count: number };
type CategoryRow = { value: string; count: number };

@Injectable()
export class SearchService {
  constructor(
    private readonly verificationService: VerificationService,
    private readonly stellarService: StellarService,
    @InjectRepository(News)
    private readonly newsRepository: Repository<News>,
  ) {}

  searchProjects(query: ProjectSearchQueryDto): ProjectSearchResponseDto {
    const limit = Math.min(query.limit ?? 20, 100);
    const offset = Math.max(query.offset ?? 0, 0);
    const normalizedQuery = (query.q ?? '').trim();
    const normalizedQueryLower = normalizedQuery.toLowerCase();
    const queryId = Number.isFinite(Number(normalizedQuery))
      ? Number(normalizedQuery)
      : null;

    const projects = this.verificationService.listProjects(query.status);

    const filtered = projects
      .filter((p) => {
        if (query.ownerPublicKey && p.ownerPublicKey !== query.ownerPublicKey) {
          return false;
        }

        if (!normalizedQuery) return true;

        if (queryId !== null && p.projectId === queryId) return true;

        return p.name.toLowerCase().includes(normalizedQueryLower);
      })
      .map((p) => this.projectToScoredItem(p, normalizedQueryLower, queryId));

    filtered.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Prefer verified, then pending, then rejected (stable UX default).
      const statusRank = (s: string) =>
        s === 'VERIFIED' ? 2 : s === 'PENDING' ? 1 : 0;
      const sr = statusRank(b.status) - statusRank(a.status);
      if (sr !== 0) return sr;
      return b.registeredAt - a.registeredAt;
    });

    const items = filtered.slice(offset, offset + limit);
    return { items, total: filtered.length, limit, offset };
  }

  async searchAssets(query: AssetSearchQueryDto): Promise<{
    assets: AssetDto[];
    hasMore: boolean;
    nextCursor?: string;
    total?: number;
  }> {
    const { assets, hasMore, nextCursor, total } =
      await this.stellarService.discoverAssets({
        assetCode: query.assetCode,
        issuer: query.issuer,
        q: query.q,
        limit: query.limit,
        cursor: query.cursor,
      });

    let filtered = assets;

    if (query.minAccounts !== undefined) {
      filtered = filtered.filter(
        (a) => (a.numAccounts ?? 0) >= query.minAccounts!,
      );
    }

    if (query.maxAccounts !== undefined) {
      filtered = filtered.filter(
        (a) => (a.numAccounts ?? 0) <= query.maxAccounts!,
      );
    }

    if (query.authRequired !== undefined) {
      filtered = filtered.filter(
        (a) => (a.flags?.authRequired ?? false) === query.authRequired,
      );
    }

    const normalizedQueryLower = (query.q ?? query.assetCode ?? '')
      .trim()
      .toLowerCase();
    const sort = query.sort ?? 'relevance';

    filtered = [...filtered].sort((a, b) => {
      if (sort === 'accounts') {
        const diff = (b.numAccounts ?? 0) - (a.numAccounts ?? 0);
        if (diff !== 0) return diff;
      } else if (normalizedQueryLower) {
        const diff =
          this.assetScore(b, normalizedQueryLower) -
          this.assetScore(a, normalizedQueryLower);
        if (diff !== 0) return diff;
      }

      return (b.numAccounts ?? 0) - (a.numAccounts ?? 0);
    });

    return { assets: filtered, hasMore, nextCursor, total };
  }

  async searchEcosystemEntities(
    query: EcosystemSearchQueryDto,
  ): Promise<EcosystemSearchResponseDto> {
    const limit = Math.min(query.limit ?? 25, 200);
    const includeCounts = query.includeCounts ?? true;
    const normalizedQuery = (query.q ?? '').trim().toLowerCase();

    const kind = query.kind ?? 'tag';

    if (kind === 'category') {
      const rows = await this.fetchCategories({ q: normalizedQuery, limit });
      return {
        items: rows.map((r) =>
          includeCounts
            ? { kind: 'category', value: r.value, count: r.count }
            : { kind: 'category', value: r.value },
        ),
      };
    }

    const rows = await this.fetchTags({ q: normalizedQuery, limit });
    return {
      items: rows.map((r) =>
        includeCounts
          ? ({
              kind: 'tag',
              value: r.value,
              count: r.count,
            } satisfies EcosystemEntityDto)
          : ({ kind: 'tag', value: r.value } satisfies EcosystemEntityDto),
      ),
    };
  }

  async linkEntities(
    query: EntityLinkingQueryDto,
  ): Promise<EntityLinkingResponseDto> {
    const limitPerType = Math.min(query.limitPerType ?? 5, 20);
    const normalizedText = query.text.trim().toLowerCase();
    const mentions = this.extractMentions(normalizedText);

    const projectMatches = this.verificationService
      .listProjects()
      .filter((project) =>
        mentions.some((mention) =>
          project.name.toLowerCase().includes(mention),
        ),
      )
      .slice(0, limitPerType)
      .map((project) => {
        const matchedMention =
          mentions.find((mention) =>
            project.name.toLowerCase().includes(mention),
          ) ?? project.name.toLowerCase();
        return {
          projectId: project.projectId,
          name: project.name,
          matchedMention,
        };
      });

    const assetMatches: Array<{
      assetCode: string;
      assetIssuer: string;
      matchedMention: string;
    }> = [];
    const seenAssetKeys = new Set<string>();

    for (const mention of mentions.slice(0, 8)) {
      if (assetMatches.length >= limitPerType) break;
      const res = await this.stellarService.discoverAssets({
        q: mention,
        limit: 5,
      });
      for (const asset of res.assets) {
        const key = `${asset.assetCode}:${asset.assetIssuer}`;
        if (seenAssetKeys.has(key)) continue;
        if (asset.assetCode.toLowerCase() !== mention) continue;
        seenAssetKeys.add(key);
        assetMatches.push({
          assetCode: asset.assetCode,
          assetIssuer: asset.assetIssuer,
          matchedMention: mention,
        });
        if (assetMatches.length >= limitPerType) break;
      }
    }

    const ecosystemRows = await this.fetchEcosystemByMentions(
      mentions,
      limitPerType,
    );

    return {
      projects: projectMatches,
      assets: assetMatches,
      ecosystem: ecosystemRows,
    };
  }

  private projectToScoredItem(
    p: ProjectVerificationDto,
    qLower: string,
    queryId: number | null,
  ): ProjectSearchItemDto {
    const score = this.projectScore(p, qLower, queryId);
    return { ...p, score };
  }

  private projectScore(
    p: ProjectVerificationDto,
    qLower: string,
    queryId: number | null,
  ): number {
    if (!qLower) return 0;
    if (queryId !== null && p.projectId === queryId) return 100;

    const nameLower = p.name.toLowerCase();
    if (nameLower === qLower) return 95;
    if (nameLower.startsWith(qLower)) return 85;
    if (nameLower.includes(qLower)) return 70;
    return 0;
  }

  private assetScore(asset: AssetDto, qLower: string): number {
    if (!qLower) return 0;
    const code = asset.assetCode?.toLowerCase?.() ?? '';
    if (code === qLower) return 100;
    if (code.startsWith(qLower)) return 80;
    if (code.includes(qLower)) return 60;
    return 0;
  }

  private async fetchTags(opts: {
    q: string;
    limit: number;
  }): Promise<TagRow[]> {
    const params: (string | number)[] = [];
    let where = '';

    if (opts.q) {
      params.push(`%${opts.q}%`);
      where = `WHERE tag LIKE $${params.length}`;
    }

    params.push(opts.limit);

    const sql = `
      SELECT tag AS value, COUNT(*)::int AS count
      FROM (
        SELECT LOWER(UNNEST(tags)) AS tag
        FROM articles
        WHERE tags IS NOT NULL AND array_length(tags, 1) > 0
      ) t
      ${where}
      GROUP BY tag
      ORDER BY count DESC, value ASC
      LIMIT $${params.length};
    `;

    return await this.newsRepository.query(sql, params);
  }

  private async fetchCategories(opts: {
    q: string;
    limit: number;
  }): Promise<CategoryRow[]> {
    const params: (string | number)[] = [];
    let where = `WHERE category IS NOT NULL`;

    if (opts.q) {
      params.push(`%${opts.q}%`);
      where += ` AND LOWER(category) LIKE $${params.length}`;
    }

    params.push(opts.limit);

    const sql = `
      SELECT LOWER(category) AS value, COUNT(*)::int AS count
      FROM articles
      ${where}
      GROUP BY LOWER(category)
      ORDER BY count DESC, value ASC
      LIMIT $${params.length};
    `;

    return await this.newsRepository.query(sql, params);
  }

  private extractMentions(text: string): string[] {
    const tokens = text
      .split(/[^a-z0-9_]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
    return [...new Set(tokens)];
  }

  private async fetchEcosystemByMentions(
    mentions: string[],
    limit: number,
  ): Promise<
    Array<{ kind: 'tag' | 'category'; value: string; matchedMention: string }>
  > {
    if (mentions.length === 0) return [];

    const params = [...mentions, limit];
    const mentionPlaceholders = mentions
      .map((_, idx) => `$${idx + 1}`)
      .join(', ');
    const limitParam = `$${mentions.length + 1}`;

    const sql = `
      WITH matched_tags AS (
        SELECT 'tag'::text AS kind, tag AS value
        FROM (
          SELECT LOWER(UNNEST(tags)) AS tag
          FROM articles
          WHERE tags IS NOT NULL AND array_length(tags, 1) > 0
        ) t
        WHERE tag IN (${mentionPlaceholders})
      ),
      matched_categories AS (
        SELECT 'category'::text AS kind, LOWER(category) AS value
        FROM articles
        WHERE category IS NOT NULL
          AND LOWER(category) IN (${mentionPlaceholders})
      )
      SELECT DISTINCT kind, value
      FROM (
        SELECT * FROM matched_tags
        UNION ALL
        SELECT * FROM matched_categories
      ) all_matches
      LIMIT ${limitParam};
    `;

    const rawRows: unknown = await this.newsRepository.query(sql, params);
    const rows = this.asEcosystemRows(rawRows);

    return rows.map((row) => ({
      kind: row.kind,
      value: row.value,
      matchedMention: row.value,
    }));
  }

  private asEcosystemRows(
    value: unknown,
  ): Array<{ kind: 'tag' | 'category'; value: string }> {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.flatMap((row) => {
      if (!row || typeof row !== 'object') {
        return [];
      }

      const record = row as Record<string, unknown>;
      const kind = record.kind;
      const rowValue = record.value;

      if (
        (kind === 'tag' || kind === 'category') &&
        typeof rowValue === 'string'
      ) {
        return [{ kind, value: rowValue }];
      }

      return [];
    });
  }
}
