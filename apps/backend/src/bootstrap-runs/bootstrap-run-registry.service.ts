import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { config } from '../lib/config';
import {
  BootstrapResourceRecord,
  BootstrapRun,
  BootstrapRunKind,
  BootstrapRunStatus,
} from './entities/bootstrap-run.entity';

export interface RecordBootstrapRunInput {
  /** Pre-generated identifier, so a caller can return it before the write settles. */
  id?: string;
  kind: BootstrapRunKind;
  resources: BootstrapResourceRecord[];
  createdBy?: string | null;
}

export interface ListBootstrapRunsOptions {
  kind?: BootstrapRunKind;
  status?: BootstrapRunStatus;
  /** Maximum rows to return. Defaults to 50, capped at 200. */
  limit?: number;
}

export interface MarkTornDownInput {
  tornDownBy?: string | null;
  summary: Record<string, unknown>;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Persists what each bootstrap run created so the teardown endpoint has an
 * authoritative list to work from.
 *
 * Recording is deliberately best-effort for the *creating* paths: a demo seed
 * or a Friendbot funding call must not fail because the registry write failed.
 * Teardown reads, by contrast, surface their errors — refusing to tear down is
 * safer than silently reporting nothing to remove.
 */
@Injectable()
export class BootstrapRunRegistryService {
  private readonly logger = new Logger(BootstrapRunRegistryService.name);

  constructor(
    @InjectRepository(BootstrapRun)
    private readonly repo: Repository<BootstrapRun>,
  ) {}

  async record(input: RecordBootstrapRunInput): Promise<BootstrapRun> {
    const entity = this.repo.create({
      ...(input.id ? { id: input.id } : {}),
      kind: input.kind,
      status: BootstrapRunStatus.ACTIVE,
      network: config.stellar.network,
      environment: config.nodeEnv,
      resources: input.resources,
      createdBy: input.createdBy ?? null,
      tornDownAt: null,
      tornDownBy: null,
      teardownSummary: null,
    });

    return this.repo.save(entity);
  }

  /**
   * Records a run without letting a registry failure break the caller.
   * Returns the run id on success, or `null` when the write failed.
   */
  async recordSafely(input: RecordBootstrapRunInput): Promise<string | null> {
    try {
      const run = await this.record(input);
      return run.id;
    } catch (error) {
      this.logger.error(
        `Failed to record ${input.kind} bootstrap run: ${this.describeError(error)}. ` +
          'The resources were still created but will not be teardown-tracked.',
      );
      return null;
    }
  }

  async findById(runId: string): Promise<BootstrapRun | null> {
    // Postgres raises on a malformed uuid literal, so screen the input first.
    if (!UUID_PATTERN.test(runId)) {
      return null;
    }

    return this.repo.findOne({ where: { id: runId } });
  }

  async list(options: ListBootstrapRunsOptions = {}): Promise<BootstrapRun[]> {
    const limit = Math.min(options.limit ?? 50, 200);
    const qb = this.repo
      .createQueryBuilder('run')
      .orderBy('run.createdAt', 'DESC')
      .limit(limit);

    if (options.kind) {
      qb.andWhere('run.kind = :kind', { kind: options.kind });
    }

    if (options.status) {
      qb.andWhere('run.status = :status', { status: options.status });
    }

    return qb.getMany();
  }

  async markTornDown(
    runId: string,
    input: MarkTornDownInput,
  ): Promise<BootstrapRun | null> {
    const run = await this.findById(runId);
    if (!run) {
      return null;
    }

    run.status = BootstrapRunStatus.TORN_DOWN;
    run.tornDownAt = new Date();
    run.tornDownBy = input.tornDownBy ?? null;
    run.teardownSummary = input.summary;

    return this.repo.save(run);
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
  }
}
