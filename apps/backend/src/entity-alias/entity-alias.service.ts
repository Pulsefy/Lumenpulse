import {
  Injectable,
  Logger,
  OnModuleInit,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import {
  EntityAlias,
  EntityKind,
} from '../database/entities/entity-alias.entity';
import {
  AliasListQueryDto,
  BatchCreateAliasDto,
  CreateAliasDto,
  NormalizeResultDto,
} from './dto/entity-alias.dto';

interface AliasCacheKey {
  entityKind: EntityKind;
  aliasLower: string;
}

interface AliasCacheEntry {
  canonicalValue: string;
  entityKind: EntityKind;
}

@Injectable()
export class EntityAliasService implements OnModuleInit {
  private readonly logger = new Logger(EntityAliasService.name);

  private aliasCache = new Map<string, AliasCacheEntry>();

  constructor(
    @InjectRepository(EntityAlias)
    private readonly repo: Repository<EntityAlias>,
  ) {}

  async onModuleInit() {
    await this.refreshCache();
  }

  async refreshCache(): Promise<number> {
    const all = await this.repo.find();
    this.aliasCache.clear();
    for (const row of all) {
      const key = this.cacheKey(row.entityKind, row.aliasLower);
      this.aliasCache.set(key, {
        canonicalValue: row.canonicalValue,
        entityKind: row.entityKind,
      });
    }
    this.logger.log(`Loaded ${all.length} entity aliases into cache`);
    return all.length;
  }

  // ---- CRUD ----

  async list(query: AliasListQueryDto): Promise<EntityAlias[]> {
    const where: Record<string, unknown> = {};
    if (query.entityKind) where.entityKind = query.entityKind;
    if (query.canonicalValue) {
      where.canonicalValue = ILike(query.canonicalValue);
    }
    return this.repo.find({
      where,
      order: { entityKind: 'ASC', canonicalValue: 'ASC', alias: 'ASC' },
    });
  }

  async getById(id: string): Promise<EntityAlias> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Alias ${id} not found`);
    return row;
  }

  async create(dto: CreateAliasDto): Promise<EntityAlias> {
    const aliasLower = dto.alias.trim().toLowerCase();
    const canonicalTrimmed = dto.canonicalValue.trim();

    const existing = await this.repo.findOne({
      where: { aliasLower },
    });
    if (existing) {
      throw new ConflictException(
        `Alias "${dto.alias}" already maps to "${existing.canonicalValue}"`,
      );
    }

    const row = this.repo.create({
      entityKind: dto.entityKind,
      canonicalValue: canonicalTrimmed,
      alias: dto.alias.trim(),
      aliasLower,
      createdBy: dto.createdBy ?? null,
      note: dto.note ?? null,
    });
    const saved = await this.repo.save(row);

    this.aliasCache.set(this.cacheKey(saved.entityKind, saved.aliasLower), {
      canonicalValue: saved.canonicalValue,
      entityKind: saved.entityKind,
    });

    this.logger.log(
      `Alias created: [${saved.entityKind}] "${saved.alias}" -> "${saved.canonicalValue}"`,
    );
    return saved;
  }

  async batchCreate(dto: BatchCreateAliasDto): Promise<{
    created: EntityAlias[];
    skipped: Array<{ alias: string; reason: string }>;
  }> {
    const created: EntityAlias[] = [];
    const skipped: Array<{ alias: string; reason: string }> = [];
    const canonicalTrimmed = dto.canonicalValue.trim();

    for (const alias of dto.aliases) {
      const aliasTrimmed = alias.trim();
      if (!aliasTrimmed) {
        skipped.push({ alias, reason: 'Empty alias' });
        continue;
      }
      const aliasLower = aliasTrimmed.toLowerCase();

      const existing = await this.repo.findOne({ where: { aliasLower } });
      if (existing) {
        skipped.push({
          alias: aliasTrimmed,
          reason: `Already maps to "${existing.canonicalValue}"`,
        });
        continue;
      }

      try {
        const row = this.repo.create({
          entityKind: dto.entityKind,
          canonicalValue: canonicalTrimmed,
          alias: aliasTrimmed,
          aliasLower,
          createdBy: dto.createdBy ?? null,
          note: dto.note ?? null,
        });
        const saved = await this.repo.save(row);
        this.aliasCache.set(
          this.cacheKey(saved.entityKind, saved.aliasLower),
          {
            canonicalValue: saved.canonicalValue,
            entityKind: saved.entityKind,
          },
        );
        created.push(saved);
      } catch (err) {
        skipped.push({
          alias: aliasTrimmed,
          reason: (err as Error).message,
        });
      }
    }

    this.logger.log(
      `Batch alias create: ${created.length} created, ${skipped.length} skipped for "${canonicalTrimmed}"`,
    );
    return { created, skipped };
  }

  async remove(id: string): Promise<void> {
    const row = await this.getById(id);
    this.aliasCache.delete(this.cacheKey(row.entityKind, row.aliasLower));
    await this.repo.delete(id);
    this.logger.log(`Alias removed: "${row.alias}" -> "${row.canonicalValue}"`);
  }

  async removeByAlias(alias: string): Promise<void> {
    const aliasLower = alias.trim().toLowerCase();
    const row = await this.repo.findOne({ where: { aliasLower } });
    if (!row) throw new NotFoundException(`Alias "${alias}" not found`);
    this.aliasCache.delete(this.cacheKey(row.entityKind, row.aliasLower));
    await this.repo.delete(row.id);
    this.logger.log(`Alias removed: "${row.alias}" -> "${row.canonicalValue}"`);
  }

  // ---- Normalization ----

  normalize(
    value: string,
    entityKind?: EntityKind,
  ): NormalizeResultDto {
    const trimmed = value.trim();
    const lower = trimmed.toLowerCase();

    const kindsToCheck: EntityKind[] = entityKind
      ? [entityKind]
      : (['project', 'asset', 'tag', 'category'] as EntityKind[]);

    for (const kind of kindsToCheck) {
      const key = this.cacheKey(kind, lower);
      const hit = this.aliasCache.get(key);
      if (hit) {
        return {
          original: trimmed,
          canonical: hit.canonicalValue,
          matched: true,
          entityKind: hit.entityKind,
        };
      }
    }

    return {
      original: trimmed,
      canonical: lower,
      matched: false,
    };
  }

  normalizeMany(
    values: string[],
    entityKind?: EntityKind,
  ): NormalizeResultDto[] {
    return values.map((v) => this.normalize(v, entityKind));
  }

  expand(canonicalValue: string, entityKind?: EntityKind): string[] {
    const canonLower = canonicalValue.trim().toLowerCase();
    const variants = new Set<string>();
    variants.add(canonicalValue.trim());

    for (const [, entry] of this.aliasCache) {
      if (entityKind && entry.entityKind !== entityKind) continue;
      if (entry.canonicalValue.toLowerCase() === canonLower) {
        variants.add(entry.canonicalValue);
      }
    }
    return [...variants];
  }

  async getAliasesForCanonical(
    canonicalValue: string,
    entityKind?: EntityKind,
  ): Promise<EntityAlias[]> {
    const where: Record<string, unknown> = {
      canonicalValue: ILike(canonicalValue.trim()),
    };
    if (entityKind) where.entityKind = entityKind;
    return this.repo.find({ where, order: { alias: 'ASC' } });
  }

  private cacheKey(entityKind: EntityKind, aliasLower: string): string {
    return `${entityKind}:${aliasLower}`;
  }
}
