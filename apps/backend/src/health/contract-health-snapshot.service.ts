import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ContractHealthService } from './contract-health.service';
import type { ContractHealthResult } from './contract-health.service';
import { ContractHealthSnapshot } from './entities/contract-health-snapshot.entity';
import {
  ContractHealthSnapshotRepository,
  FindHistoryOptions,
} from './contract-health-snapshot.repository';

// ---------------------------------------------------------------------------
// Diff types
// ---------------------------------------------------------------------------

export type ContractStatusChange = {
  /** Soroban contract identifier key (e.g. 'lumenToken'). */
  name: string;
  /** Status in the earlier (baseline) snapshot. */
  from: string;
  /** Status in the later (current) snapshot. */
  to: string;
};

export type ReadMethodChange = {
  contractName: string;
  method: string;
  from: string;
  to: string;
};

export interface SnapshotDiff {
  /** UUID of the earlier snapshot used as baseline. */
  baselineId: string;
  /** UUID of the later snapshot being compared. */
  currentId: string;
  /** ISO timestamp of the baseline snapshot. */
  baselineCapturedAt: string;
  /** ISO timestamp of the current snapshot. */
  currentCapturedAt: string;
  /** Overall status change ('ok'→'error', 'error'→'ok', or 'unchanged'). */
  overallStatusChange: 'improved' | 'degraded' | 'unchanged';
  /** Numeric deltas for each summary counter. */
  summaryDelta: {
    reachable: number;
    misconfigured: number;
    unreachable: number;
  };
  /** Per-contract top-level status changes. */
  contractStatusChanges: ContractStatusChange[];
  /** Per-contract read-method status changes. */
  readMethodChanges: ReadMethodChange[];
  /** True when contractStatusChanges and readMethodChanges are both empty. */
  noDrift: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class ContractHealthSnapshotService {
  private readonly logger = new Logger(ContractHealthSnapshotService.name);

  constructor(
    private readonly contractHealthService: ContractHealthService,
    private readonly snapshotRepo: ContractHealthSnapshotRepository,
  ) {}

  /**
   * Run a live health check and persist the result as a new snapshot row.
   *
   * @param triggeredBy  Label stored on the row ('scheduler' | 'manual').
   */
  async captureSnapshot(
    triggeredBy: 'scheduler' | 'manual' = 'scheduler',
  ): Promise<ContractHealthSnapshot> {
    this.logger.log(
      `Capturing contract health snapshot (triggeredBy=${triggeredBy})`,
    );

    const report = await this.contractHealthService.getContractHealthReport();

    const snapshot = await this.snapshotRepo.save({
      capturedAt: new Date(report.checkedAt),
      network: report.network,
      overallStatus: report.status,
      summary: report.summary,
      contracts: report.contracts,
      triggeredBy,
    });

    this.logger.log(
      `Snapshot ${snapshot.id} saved — status=${report.status}, ` +
        `reachable=${report.summary.reachable}/${report.summary.total}`,
    );

    return snapshot;
  }

  /**
   * Return the most recent persisted snapshot.
   * Throws NotFoundException when no snapshots have been captured yet.
   */
  async getLatest(network?: string): Promise<ContractHealthSnapshot> {
    const snapshot = await this.snapshotRepo.findLatest(network);
    if (!snapshot) {
      throw new NotFoundException(
        'No contract health snapshots have been captured yet.',
      );
    }
    return snapshot;
  }

  /**
   * Return a paginated, newest-first list of snapshots.
   */
  async getHistory(
    options: FindHistoryOptions = {},
  ): Promise<ContractHealthSnapshot[]> {
    return this.snapshotRepo.findHistory(options);
  }

  /**
   * Return a snapshot by its UUID.
   * Throws NotFoundException when the id does not exist.
   */
  async getById(id: string): Promise<ContractHealthSnapshot> {
    const snapshot = await this.snapshotRepo.findById(id);
    if (!snapshot) {
      throw new NotFoundException(`Snapshot ${id} not found.`);
    }
    return snapshot;
  }

  /**
   * Compute a diff between:
   *   - the two most recent snapshots when no ids are supplied, OR
   *   - a specific (baselineId, currentId) pair.
   *
   * Returns a structured SnapshotDiff so callers can render it without
   * any further computation.
   */
  async getDiff(
    baselineId?: string,
    currentId?: string,
  ): Promise<SnapshotDiff> {
    let baseline: ContractHealthSnapshot;
    let current: ContractHealthSnapshot;

    if (baselineId && currentId) {
      [baseline, current] = await Promise.all([
        this.getById(baselineId),
        this.getById(currentId),
      ]);
    } else {
      const [a, b] = await this.snapshotRepo.findLatestTwo();
      if (!a || !b) {
        throw new NotFoundException(
          'At least two snapshots are required to compute a diff. ' +
            'Only one (or zero) snapshots have been captured so far.',
        );
      }
      // findLatestTwo returns newest-first; swap so baseline is older.
      current = a;
      baseline = b;
    }

    return this.buildDiff(baseline, current);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private buildDiff(
    baseline: ContractHealthSnapshot,
    current: ContractHealthSnapshot,
  ): SnapshotDiff {
    const overallStatusChange = this.deriveOverallChange(
      baseline.overallStatus,
      current.overallStatus,
    );

    const summaryDelta = {
      reachable: current.summary.reachable - baseline.summary.reachable,
      misconfigured:
        current.summary.misconfigured - baseline.summary.misconfigured,
      unreachable: current.summary.unreachable - baseline.summary.unreachable,
    };

    const contractStatusChanges = this.diffContractStatuses(
      baseline.contracts,
      current.contracts,
    );

    const readMethodChanges = this.diffReadMethods(
      baseline.contracts,
      current.contracts,
    );

    return {
      baselineId: baseline.id,
      currentId: current.id,
      baselineCapturedAt: baseline.capturedAt.toISOString(),
      currentCapturedAt: current.capturedAt.toISOString(),
      overallStatusChange,
      summaryDelta,
      contractStatusChanges,
      readMethodChanges,
      noDrift:
        contractStatusChanges.length === 0 && readMethodChanges.length === 0,
    };
  }

  private deriveOverallChange(
    from: string,
    to: string,
  ): 'improved' | 'degraded' | 'unchanged' {
    if (from === to) return 'unchanged';
    // 'ok' is better than 'error'
    if (from === 'error' && to === 'ok') return 'improved';
    return 'degraded';
  }

  private diffContractStatuses(
    baseline: ContractHealthResult[],
    current: ContractHealthResult[],
  ): ContractStatusChange[] {
    const baselineMap = new Map(baseline.map((c) => [c.name, c.status]));
    const changes: ContractStatusChange[] = [];

    for (const contract of current) {
      const prev = baselineMap.get(contract.name);
      if (prev !== undefined && prev !== contract.status) {
        changes.push({ name: contract.name, from: prev, to: contract.status });
      }
    }

    return changes;
  }

  private diffReadMethods(
    baseline: ContractHealthResult[],
    current: ContractHealthResult[],
  ): ReadMethodChange[] {
    const baselineMap = new Map(
      baseline.map((c) => [
        c.name,
        new Map(c.readMethods.map((m) => [m.method, m.status])),
      ]),
    );

    const changes: ReadMethodChange[] = [];

    for (const contract of current) {
      const prevMethods = baselineMap.get(contract.name);
      if (!prevMethods) continue;

      for (const rm of contract.readMethods) {
        const prev = prevMethods.get(rm.method);
        if (prev !== undefined && prev !== rm.status) {
          changes.push({
            contractName: contract.name,
            method: rm.method,
            from: prev,
            to: rm.status,
          });
        }
      }
    }

    return changes;
  }
}
