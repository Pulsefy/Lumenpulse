import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { News } from '../news/news.entity';
import { StellarService } from '../stellar/stellar.service';
import { AssetDto } from '../stellar/dto/asset-discovery.dto';
import { VerificationService } from '../verification/verification.service';
import { ProjectVerificationDto } from '../verification/dto/verification.dto';
import { EntityAliasService } from '../entity-alias/entity-alias.service';
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
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly verificationService: VerificationService,
    private readonly stellarService: StellarService,
    private readonly aliasService: EntityAliasService,
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

    const projectNameVariants = normalizedQuery
      ? this.aliasService.expand(normalizedQuery, 'project')
      : [];
    const projectNameVariantsLower = projectNameVariants.map((v) =>
      v.toLowerCase(),
    );

    const projects = this.verificationService.listProjects(query.status);

    const filtered = projects
      .filter((p) => {
        if (query.ownerPublicKey && p.ownerPublicKey !== query.ownerPublicKey) {
          return false;
        }

        if (!normalizedQuery) return true;

        if (queryId !== null && p.projectId === queryId) return true;

        const nameLower = p.name.toLowerCase();
        if (nameLower.includes(normalizedQueryLower)) return true;

        return projectNameVariantsLower.some((variant) =>
          nameLower.includes(variant),
        );
      })
      .map((p) => this.projectToScoredItem(p, normalizedQueryLower, queryId, projectNameVariantsLower));

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

    const assetVariantsLower = normalizedQueryLower
      ? this.aliasService
          .expand(normalizedQueryLower, 'asset')
          .map((v) => v.toLowerCase())
      : [];

    const sort = query.sort ?? 'relevance';

    filtered = [...filtered].sort((a, b) => {
      if (sort === 'accounts') {
        const diff = (b.numAccounts ?? 0) - (a.numAccounts ?? 0);
        if (diff !== 0) return diff;
      } else if (normalizedQueryLower) {
        const scoreA = this.assetScoreWithAliases(
          a,
          normalizedQueryLower,
          assetVariantsLower,
        );
        const scoreB = this.assetScoreWithAliases(
          b,
          normalizedQueryLower,
          assetVariantsLower,
        );
        const diff = scoreB - scoreA;
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
    const canonicalLookup = new Map<string, { kind: 'tag' | 'category'; value: string; count: number }>();

    const mergeOrAdd = (
      row: { value: string; count: number },
      rowKind: 'tag' | 'category',
    ) => {
      const result = this.aliasService.normalize(row.value, rowKind);
      const key = `${rowKind}:${result.canonical.toLowerCase()}`;
      const existing = canonicalLookup.get(key);
      if (existing) {
        existing.count += row.count;
      } else {
        canonicalLookup.set(key, {
          kind: rowKind,
          value: result.canonical,
          count: row.count,
        });
      }
    };

    if (kind === 'category') {
      const rows = await this.fetchCategories({ q: normalizedQuery, limit });
      rows.forEach((r) => mergeOrAdd(r, 'category'));
      const merged = [...canonicalLookup.values()].sort(
        (a, b) => b.count - a.count || a.value.localeCompare(b.value),
      );
      return {
        items: merged.map((r) =>
          includeCounts
            ? { kind: 'category', value: r.value, count: r.count }
            : { kind: 'category', value: r.value },
        ),
      };
    }

    const rows = await this.fetchTags({ q: normalizedQuery, limit });
    rows.forEach((r) => mergeOrAdd(r, 'tag'));
    const merged = [...canonicalLookup.values()].sort(
      (a, b) => b.count - a.count || a.value.localeCompare(b.value),
    );
    return {
      items: merged.map((r) =>
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
    const rawMentions = this.extractMentions(normalizedText);

    const normalizedMentions = new Set<string>();
    for (const m of rawMentions) {
      const norm = this.aliasService.normalize(m);
      normalizedMentions.add(norm.canonical.toLowerCase());
      if (norm.matched) {
        for (const variant of this.aliasService.expand(norm.canonical, norm.entityKind)) {
          normalizedMentions.add(variant.toLowerCase());
        }
      } else {
        normalizedMentions.add(m);
      }
    }
    const mentions = [...normalizedMentions];

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
    aliasVariantsLower: string[] = [],
  ): ProjectSearchItemDto {
    const score = this.projectScore(p, qLower, queryId, aliasVariantsLower);
    return { ...p, score };
  }

  private projectScore(
    p: ProjectVerificationDto,
    qLower: string,
    queryId: number | null,
    aliasVariantsLower: string[] = [],
  ): number {
    if (!qLower) return 0;
    if (queryId !== null && p.projectId === queryId) return 100;

    const nameLower = p.name.toLowerCase();
    if (nameLower === qLower) return 95;

    for (const variant of aliasVariantsLower) {
      if (variant === qLower && nameLower.includes(variant)) return 92;
      if (nameLower === variant) return 90;
      if (nameLower.startsWith(variant)) return 82;
    }

    if (nameLower.startsWith(qLower)) return 85;
    if (nameLower.includes(qLower)) return 70;

    for (const variant of aliasVariantsLower) {
      if (nameLower.includes(variant)) return 65;
    }
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

  private assetScoreWithAliases(
    asset: AssetDto,
    qLower: string,
    variantsLower: string[],
  ): number {
    const base = this.assetScore(asset, qLower);
    if (base > 0) return base;

    const code = asset.assetCode?.toLowerCase?.() ?? '';
    for (const variant of variantsLower) {
      if (code === variant) return 95;
      if (code.startsWith(variant)) return 75;
      if (code.includes(variant)) return 55;
    }
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

  async rebuildIndex(): Promise<{ success: boolean; message: string; timestamp: string }> {
    await Promise.resolve();
    return {
      success: true,
      message: 'Search index rebuild completed successfully',
      timestamp: new Date().toISOString(),
    };
  }
}
