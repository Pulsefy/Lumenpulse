import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { config } from '../lib/config';
import { BootstrapRunRegistryService } from '../bootstrap-runs/bootstrap-run-registry.service';
import {
  BootstrapResourceRecord,
  BootstrapResourceType,
  BootstrapRunKind,
} from '../bootstrap-runs/entities/bootstrap-run.entity';
import {
  DemoScenario,
  SeedResultDto,
  ResetResultDto,
  BootstrapStatusDto,
} from './dto/demo-bootstrap.dto';

/**
 * DemoBootstrapService
 *
 * Provides safe, repeatable seeding of demo-friendly testnet scenarios
 * used in contributor review and MVP walkthroughs.
 *
 * Environment gate:
 *  - Only available when STELLAR_NETWORK=testnet AND BOOTSTRAP_DEMO_DATA_ENABLED=true.
 *  - All mutating methods throw ServiceUnavailableException outside the gate.
 *
 * Safety:
 *  - All seed operations are idempotent — callers can pass resetBeforeSeed=true
 *    (the default) to clear previous state before re-seeding.
 *  - No real on-chain transactions are submitted; data is held in-memory.
 *  - Every seed is recorded as a bootstrap run so it can later be undone by
 *    identifier through the teardown endpoint. See BootstrapTeardownService.
 */
interface SeededContributor {
  address: string;
  githubHandle: string;
  reputationScore: number;
  tier: string;
  registeredAt: string;
}

interface SeededGrantRound {
  id: number;
  name: string;
  startTime: string;
  endTime: string;
  totalPool: string;
  contributorCount: number;
  status: string;
}

interface SeededState {
  contributors: SeededContributor[];
  grantRounds: SeededGrantRound[];
  seededAt: string;
}

@Injectable()
export class DemoBootstrapService {
  private readonly logger = new Logger(DemoBootstrapService.name);
  private state: SeededState | null = null;

  constructor(private readonly runRegistry: BootstrapRunRegistryService) {}

  /**
   * Returns true when the bootstrap endpoints are permitted:
   *  - Stellar network must be testnet
   *  - BOOTSTRAP_DEMO_DATA_ENABLED feature flag must be true
   */
  get isEnvironmentAllowed(): boolean {
    return (
      config.stellar.network === 'testnet' &&
      config.featureFlags.bootstrapDemoData === true
    );
  }

  /**
   * GET /demo-bootstrap/status
   * Returns the current state of the demo seed without mutating anything.
   */
  getStatus(): BootstrapStatusDto {
    return {
      enabled: this.isEnvironmentAllowed,
      network: config.stellar.network,
      isSeeded: this.state !== null,
      lastSeededAt: this.state?.seededAt,
      seededData: this.state
        ? {
            contributors: this.state.contributors.length,
            grantRounds: this.state.grantRounds.length,
          }
        : undefined,
    };
  }

  /**
   * POST /demo-bootstrap/seed
   * Seeds demo data. Idempotent — safe to call repeatedly.
   *
   * The returned `runId` identifies everything this call created and is the
   * handle the teardown endpoint takes. It is absent only when the registry
   * write failed, which is logged but never fails the seed itself.
   */
  async seed(
    scenario: DemoScenario = DemoScenario.FULL,
    resetBeforeSeed = true,
    createdBy: string | null = null,
  ): Promise<SeedResultDto> {
    this.assertEnvironmentAllowed();

    if (resetBeforeSeed) {
      this.resetInternal();
    }

    const seededAt = new Date().toISOString();
    const contributors: SeededContributor[] = [];
    const grantRounds: SeededGrantRound[] = [];

    if (
      scenario === DemoScenario.CONTRIBUTORS ||
      scenario === DemoScenario.FULL
    ) {
      contributors.push(...this.seedContributors());
    }

    if (
      scenario === DemoScenario.GRANT_ROUND ||
      scenario === DemoScenario.FULL
    ) {
      grantRounds.push(...this.seedGrantRounds());
    }

    this.state = { contributors, grantRounds, seededAt };

    const runId = await this.runRegistry.recordSafely({
      kind: BootstrapRunKind.DEMO_SEED,
      createdBy,
      resources: this.describeSeededResources(contributors, grantRounds),
    });

    this.logger.log(
      `Demo data seeded: scenario=${scenario} contributors=${contributors.length} ` +
        `grantRounds=${grantRounds.length} runId=${runId ?? 'untracked'}`,
    );

    return {
      success: true,
      message: `Successfully seeded demo scenario '${scenario}'`,
      seededAt,
      runId: runId ?? undefined,
      details: {
        scenario,
        contributorsSeeded: contributors.length,
        grantRoundsSeeded: grantRounds.length,
      },
    };
  }

  /**
   * POST /demo-bootstrap/reset
   * Clears all seeded demo data regardless of which run produced it. Use the
   * teardown endpoint instead when only one run should be undone.
   */
  reset(): ResetResultDto {
    this.assertEnvironmentAllowed();
    const hadState = this.state !== null;
    this.resetInternal();

    this.logger.log(`Demo data reset: hadPreviousState=${hadState}`);

    return {
      success: true,
      message: hadState
        ? 'Demo data has been cleared'
        : 'No demo data was present — nothing to clear',
    };
  }

  /**
   * Whether a resource recorded by a bootstrap run is still present in the
   * seeded state. Used by the teardown dry run.
   */
  hasSeededResource(type: BootstrapResourceType, identifier: string): boolean {
    if (!this.state) {
      return false;
    }

    if (type === BootstrapResourceType.DEMO_CONTRIBUTOR) {
      return this.state.contributors.some(
        (contributor) => contributor.address === identifier,
      );
    }

    if (type === BootstrapResourceType.DEMO_GRANT_ROUND) {
      return this.state.grantRounds.some(
        (round) => String(round.id) === identifier,
      );
    }

    return false;
  }

  /**
   * Removes a single seeded resource. Returns true when something was
   * actually removed, false when it was already gone — teardown relies on
   * that distinction to report `removed` versus `not_found`.
   */
  removeSeededResource(
    type: BootstrapResourceType,
    identifier: string,
  ): boolean {
    if (!this.state || !this.hasSeededResource(type, identifier)) {
      return false;
    }

    if (type === BootstrapResourceType.DEMO_CONTRIBUTOR) {
      this.state.contributors = this.state.contributors.filter(
        (contributor) => contributor.address !== identifier,
      );
    } else if (type === BootstrapResourceType.DEMO_GRANT_ROUND) {
      this.state.grantRounds = this.state.grantRounds.filter(
        (round) => String(round.id) !== identifier,
      );
    } else {
      return false;
    }

    // Drop the state object entirely once the last resource is gone so
    // getStatus() reports isSeeded=false rather than an empty seed.
    if (
      this.state.contributors.length === 0 &&
      this.state.grantRounds.length === 0
    ) {
      this.resetInternal();
    }

    return true;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private assertEnvironmentAllowed(): void {
    if (!this.isEnvironmentAllowed) {
      const reasons: string[] = [];
      if (config.stellar.network !== 'testnet') {
        reasons.push(
          `STELLAR_NETWORK=${config.stellar.network} (must be testnet)`,
        );
      }
      if (!config.featureFlags.bootstrapDemoData) {
        reasons.push('BOOTSTRAP_DEMO_DATA_ENABLED is not set to true');
      }
      throw new ServiceUnavailableException(
        `Demo bootstrap is disabled in this environment. ${reasons.join('; ')}. ` +
          'Set STELLAR_NETWORK=testnet and BOOTSTRAP_DEMO_DATA_ENABLED=true to enable.',
      );
    }
  }

  private describeSeededResources(
    contributors: SeededContributor[],
    grantRounds: SeededGrantRound[],
  ): BootstrapResourceRecord[] {
    return [
      ...contributors.map((contributor) => ({
        type: BootstrapResourceType.DEMO_CONTRIBUTOR,
        identifier: contributor.address,
        label: `Demo contributor ${contributor.githubHandle}`,
      })),
      ...grantRounds.map((round) => ({
        type: BootstrapResourceType.DEMO_GRANT_ROUND,
        identifier: String(round.id),
        label: round.name,
      })),
    ];
  }

  private resetInternal(): void {
    this.state = null;
  }

  private seedContributors(): SeededContributor[] {
    const now = new Date();
    const demoContributors: SeededContributor[] = [
      {
        address: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        githubHandle: 'demo-alice',
        reputationScore: 120,
        tier: 'Core',
        registeredAt: new Date(
          now.getTime() - 30 * 24 * 3600 * 1000,
        ).toISOString(),
      },
      {
        address: 'GBK37RY6M2X4M74H5QZ3HY2A3EHL73LIV52AHP4R6Q3I4G4R4KZV2ABC',
        githubHandle: 'demo-bob',
        reputationScore: 55,
        tier: 'Architect',
        registeredAt: new Date(
          now.getTime() - 14 * 24 * 3600 * 1000,
        ).toISOString(),
      },
      {
        address: 'GCM37RY6M2X4M74H5QZ3HY2A3EHL73LIV52AHP4R6Q3I4G4R4KZV2DEF',
        githubHandle: 'demo-carol',
        reputationScore: 15,
        tier: 'Builder',
        registeredAt: new Date(
          now.getTime() - 3 * 24 * 3600 * 1000,
        ).toISOString(),
      },
    ];
    return demoContributors;
  }

  private seedGrantRounds(): SeededGrantRound[] {
    const now = Date.now();
    const demoRounds: SeededGrantRound[] = [
      {
        id: 0,
        name: 'Demo: Stellar Community Builders — Round 1',
        startTime: new Date(now - 7 * 24 * 3600 * 1000).toISOString(),
        endTime: new Date(now + 14 * 24 * 3600 * 1000).toISOString(),
        totalPool: '5000000000000',
        contributorCount: 3,
        status: 'ACTIVE',
      },
      {
        id: 1,
        name: 'Demo: Soroban MVP Walkthrough — Round 0',
        startTime: new Date(now - 30 * 24 * 3600 * 1000).toISOString(),
        endTime: new Date(now - 10 * 24 * 3600 * 1000).toISOString(),
        totalPool: '1000000000000',
        contributorCount: 2,
        status: 'DISTRIBUTED',
      },
    ];
    return demoRounds;
  }
}
