import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { config } from '../lib/config';
import { BootstrapRunRegistryService } from '../bootstrap-runs/bootstrap-run-registry.service';
import {
  BootstrapResourceRecord,
  BootstrapResourceType,
  BootstrapRun,
  BootstrapRunKind,
  BootstrapRunStatus,
} from '../bootstrap-runs/entities/bootstrap-run.entity';
import { DemoBootstrapService } from './demo-bootstrap.service';
import {
  BootstrapResourceOutcomeDto,
  BootstrapRunSummaryDto,
  BootstrapTeardownResultDto,
  BootstrapTeardownSummaryDto,
  TeardownAction,
} from './dto/bootstrap-teardown.dto';

export interface TeardownOptions {
  dryRun?: boolean;
  requestedBy?: string | null;
}

export interface EnvironmentGate {
  allowed: boolean;
  reasons: string[];
}

/**
 * Friendbot-funded testnet accounts stay on-chain forever — Stellar has no
 * "delete account" for an account the backend does not hold the secret for.
 * Teardown therefore discards the local record and says so explicitly rather
 * than pretending the account is gone.
 */
const TESTNET_ACCOUNT_SKIP_REASON =
  'Friendbot-funded testnet accounts cannot be deleted on-chain. The bootstrap ' +
  'record was discarded; the account itself remains on testnet.';

/**
 * Undoes a single bootstrap run.
 *
 * Safety model — a teardown only runs when *both* hold:
 *  1. NODE_ENV is not `production`, and
 *  2. the environment is explicitly marked as testnet (`STELLAR_NETWORK=testnet`)
 *     or as a development environment (`NODE_ENV` of `development` or `test`).
 *
 * Anything else — staging on mainnet, an unmarked deployment, production — is
 * refused with 403 and an explanation. The check is evaluated per request, not
 * cached, so a misconfigured deploy cannot leave a stale "allowed" verdict.
 */
@Injectable()
export class BootstrapTeardownService {
  private readonly logger = new Logger(BootstrapTeardownService.name);

  constructor(
    private readonly runRegistry: BootstrapRunRegistryService,
    private readonly demoBootstrapService: DemoBootstrapService,
  ) {}

  /**
   * Evaluates the teardown safety gate without performing any work.
   * Exposed so callers (and the status endpoint) can check before committing.
   */
  evaluateEnvironmentGate(): EnvironmentGate {
    const network = config.stellar.network;
    const nodeEnv = config.nodeEnv;
    const reasons: string[] = [];

    if (nodeEnv === 'production') {
      reasons.push(
        'NODE_ENV=production — bootstrap teardown is never permitted in production',
      );
    }

    const isMarkedTestnet = network === 'testnet';
    const isMarkedDevelopment = nodeEnv === 'development' || nodeEnv === 'test';

    if (!isMarkedTestnet && !isMarkedDevelopment) {
      reasons.push(
        `environment is not explicitly marked as testnet or development ` +
          `(STELLAR_NETWORK=${network}, NODE_ENV=${nodeEnv})`,
      );
    }

    return { allowed: reasons.length === 0, reasons };
  }

  /**
   * Lists recorded bootstrap runs, newest first, so a contributor can find the
   * identifier to tear down.
   */
  async listRuns(options: {
    kind?: BootstrapRunKind;
    status?: BootstrapRunStatus;
    limit?: number;
  }): Promise<BootstrapRunSummaryDto[]> {
    const runs = await this.runRegistry.list(options);
    return runs.map((run) => this.toRunSummary(run));
  }

  /**
   * Removes everything a specific bootstrap run created.
   *
   * With `dryRun: true` nothing is mutated and the response lists exactly what
   * a real teardown would do — including resources it cannot remove.
   */
  async teardown(
    runId: string,
    options: TeardownOptions = {},
  ): Promise<BootstrapTeardownResultDto> {
    const dryRun = options.dryRun === true;
    const gate = this.evaluateEnvironmentGate();

    if (!gate.allowed) {
      this.logger.warn(
        `Bootstrap teardown for run ${runId} REFUSED: ${gate.reasons.join('; ')}`,
      );
      throw new ForbiddenException({
        message:
          'Bootstrap teardown is refused in this environment. ' +
          'It only runs against an environment explicitly marked as testnet ' +
          '(STELLAR_NETWORK=testnet) or development (NODE_ENV=development|test), ' +
          'and never in production.',
        reasons: gate.reasons,
        environment: this.describeEnvironment(),
      });
    }

    const run = await this.runRegistry.findById(runId);
    if (!run) {
      throw new NotFoundException(
        `No bootstrap run found with identifier '${runId}'. ` +
          'Use GET /demo-bootstrap/runs to list recorded runs.',
      );
    }

    if (run.status === BootstrapRunStatus.TORN_DOWN && !dryRun) {
      return this.buildAlreadyTornDownResult(run);
    }

    const outcomes = run.resources.map((resource) =>
      dryRun ? this.planRemoval(resource) : this.executeRemoval(resource),
    );
    const summary = this.summarize(outcomes);

    if (dryRun) {
      return {
        success: true,
        runId: run.id,
        dryRun: true,
        status: run.status,
        message:
          `Dry run — nothing was removed. ${summary.removed} of ${summary.total} ` +
          `recorded resource(s) would be removed.`,
        environment: this.describeEnvironment(),
        resources: outcomes,
        summary,
      };
    }

    await this.runRegistry.markTornDown(run.id, {
      tornDownBy: options.requestedBy ?? null,
      summary: { ...summary, resources: outcomes },
    });

    this.logger.log(
      `Bootstrap run ${run.id} (${run.kind}) torn down by ` +
        `${options.requestedBy ?? 'unknown'}: removed=${summary.removed} ` +
        `notFound=${summary.notFound} skipped=${summary.skipped}`,
    );

    return {
      success: true,
      runId: run.id,
      dryRun: false,
      status: BootstrapRunStatus.TORN_DOWN,
      message:
        `Bootstrap run torn down. Removed ${summary.removed} of ${summary.total} ` +
        `recorded resource(s).`,
      environment: this.describeEnvironment(),
      resources: outcomes,
      summary,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Dry-run planning: reports what would happen without mutating anything. */
  private planRemoval(
    resource: BootstrapResourceRecord,
  ): BootstrapResourceOutcomeDto {
    if (resource.type === BootstrapResourceType.TESTNET_ACCOUNT) {
      return {
        ...resource,
        action: TeardownAction.SKIPPED,
        reason: TESTNET_ACCOUNT_SKIP_REASON,
      };
    }

    const present = this.demoBootstrapService.hasSeededResource(
      resource.type,
      resource.identifier,
    );

    return {
      ...resource,
      action: present ? TeardownAction.WOULD_REMOVE : TeardownAction.NOT_FOUND,
      ...(present
        ? {}
        : {
            reason: 'Already absent from the seeded state — nothing to remove',
          }),
    };
  }

  private executeRemoval(
    resource: BootstrapResourceRecord,
  ): BootstrapResourceOutcomeDto {
    if (resource.type === BootstrapResourceType.TESTNET_ACCOUNT) {
      return {
        ...resource,
        action: TeardownAction.SKIPPED,
        reason: TESTNET_ACCOUNT_SKIP_REASON,
      };
    }

    const removed = this.demoBootstrapService.removeSeededResource(
      resource.type,
      resource.identifier,
    );

    return {
      ...resource,
      action: removed ? TeardownAction.REMOVED : TeardownAction.NOT_FOUND,
      ...(removed
        ? {}
        : {
            reason: 'Already absent from the seeded state — nothing to remove',
          }),
    };
  }

  /**
   * `would_remove` counts toward `removed` so a dry run and the real teardown
   * report the same numbers for the same state.
   */
  private summarize(
    outcomes: BootstrapResourceOutcomeDto[],
  ): BootstrapTeardownSummaryDto {
    return {
      total: outcomes.length,
      removed: outcomes.filter(
        (outcome) =>
          outcome.action === TeardownAction.REMOVED ||
          outcome.action === TeardownAction.WOULD_REMOVE,
      ).length,
      notFound: outcomes.filter(
        (outcome) => outcome.action === TeardownAction.NOT_FOUND,
      ).length,
      skipped: outcomes.filter(
        (outcome) => outcome.action === TeardownAction.SKIPPED,
      ).length,
    };
  }

  private buildAlreadyTornDownResult(
    run: BootstrapRun,
  ): BootstrapTeardownResultDto {
    const outcomes: BootstrapResourceOutcomeDto[] = run.resources.map(
      (resource) => ({
        ...resource,
        action:
          resource.type === BootstrapResourceType.TESTNET_ACCOUNT
            ? TeardownAction.SKIPPED
            : TeardownAction.NOT_FOUND,
        reason:
          resource.type === BootstrapResourceType.TESTNET_ACCOUNT
            ? TESTNET_ACCOUNT_SKIP_REASON
            : 'Removed by an earlier teardown of this run',
      }),
    );

    return {
      success: true,
      runId: run.id,
      dryRun: false,
      status: 'already_torn_down',
      message:
        `Bootstrap run was already torn down at ` +
        `${run.tornDownAt?.toISOString() ?? 'an earlier time'}. Nothing left to remove.`,
      environment: this.describeEnvironment(),
      resources: outcomes,
      summary: this.summarize(outcomes),
    };
  }

  private describeEnvironment(): { network: string; nodeEnv: string } {
    return { network: config.stellar.network, nodeEnv: config.nodeEnv };
  }

  private toRunSummary(run: BootstrapRun): BootstrapRunSummaryDto {
    return {
      runId: run.id,
      kind: run.kind,
      status: run.status,
      network: run.network,
      environment: run.environment,
      resourceCount: run.resources.length,
      createdAt: run.createdAt.toISOString(),
      tornDownAt: run.tornDownAt?.toISOString(),
    };
  }
}
