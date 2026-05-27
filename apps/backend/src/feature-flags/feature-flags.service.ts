import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FeatureFlag } from './feature-flag.entity';

@Injectable()
export class FeatureFlagsService implements OnModuleInit {
  private readonly logger = new Logger(FeatureFlagsService.name);
  private cache = new Map<string, FeatureFlag | null>();

  constructor(
    @InjectRepository(FeatureFlag)
    private readonly repo: Repository<FeatureFlag>,
  ) {}

  async onModuleInit() {
    await this.refreshCache();
  }

  async refreshCache() {
    const all = await this.repo.find();
    this.cache.clear();
    for (const f of all) this.cache.set(f.key, f);
    this.logger.log(`Loaded ${all.length} feature flags into cache`);
  }

  async listFlags(): Promise<FeatureFlag[]> {
    return this.repo.find();
  }

  async getFlag(key: string): Promise<FeatureFlag | null> {
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    const f = await this.repo.findOne({ where: { key } });
    this.cache.set(key, f ?? null);
    return f ?? null;
  }

  async isEnabled(
    key: string,
    _context?: Record<string, unknown>,
  ): Promise<boolean> {
    void _context;
    const f = await this.getFlag(key);
    return !!(f && f.enabled);
  }

  async upsert(
    key: string,
    enabled: boolean,
    conditions?: Record<string, unknown>,
  ) {
    let f = await this.repo.findOne({ where: { key } });
    if (!f) {
      f = this.repo.create({ key, enabled, conditions: conditions ?? null });
    } else {
      f.enabled = enabled;
      f.conditions = conditions ?? null;
    }
    const saved = await this.repo.save(f);
    this.cache.set(saved.key, saved);
    return saved;
  }

  async remove(key: string): Promise<void> {
    await this.repo.delete({ key });
    this.cache.delete(key);
  }
}
