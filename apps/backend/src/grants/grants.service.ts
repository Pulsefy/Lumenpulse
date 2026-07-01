import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  RoundDto,
  // ProjectQfDto,
  ProjectAllocationDto,
  RoundParticipationMetricsDto,
  ContributionRecordDto,
  RoundSummaryDto,
  RoundExportDto,
  CreateRoundDto,
  FundPoolDto,
  ApproveProjectDto,
  RecordContributionDto,
  DistributeDto,
  LeaderboardQueryDto,
  LeaderboardResponseDto,
  LeaderboardEntryDto,
} from './dto/grants.dto';

/**
 * In-memory store for round and contribution data.
 * In production this would be backed by a DB and read from on-chain state
 * via Soroban RPC. The service exposes the same interface either way.
 */
interface RoundRecord {
  id: number;
  name: string;
  tokenAddress: string;
  startTime: number;
  endTime: number;
  totalPool: bigint;
  isFinalized: boolean;
  isDistributed: boolean;
  // projectId -> contributor -> amount
  contributions: Map<number, Map<string, bigint>>;
  eligibleProjects: Set<number>;
}

@Injectable()
export class GrantsService {
  private readonly logger = new Logger(GrantsService.name);
  private rounds = new Map<number, RoundRecord>();
  private nextRoundId = 0;

  constructor(private readonly config: ConfigService) {
    if (
      process.env.NODE_ENV !== 'production' &&
      process.env.NODE_ENV !== 'test'
    ) {
      this.seedRounds();
    }
  }

  private seedRounds() {
    const now = Math.floor(Date.now() / 1000);

    // Round 0: Active round
    const activeRoundId = this.nextRoundId++;
    const activeRound: RoundRecord = {
      id: activeRoundId,
      name: 'Stellar Community Fund - Round 14',
      tokenAddress: 'CBFQX3K5PZ...TESTNET',
      startTime: now - 3 * 24 * 3600, // 3 days ago
      endTime: now + 7 * 24 * 3600, // 7 days from now
      totalPool: 5000000000000n, // 500,000 XLM (7 decimals)
      isFinalized: false,
      isDistributed: false,
      contributions: new Map([
        [
          1,
          new Map([
            [
              'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
              15000000000n,
            ], // 1,500 XLM
            [
              'GBK37RY6M2X4M74H5QZ3HY2A3EHL73LIV52AHP4R6Q3I4G4R4KZV2OTHER1',
              5000000000n,
            ], // 500 XLM
          ]),
        ],
        [
          2,
          new Map([
            [
              'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
              8000000000n,
            ], // 800 XLM
            [
              'GBK37RY6M2X4M74H5QZ3HY2A3EHL73LIV52AHP4R6Q3I4G4R4KZV2OTHER2',
              12000000000n,
            ], // 1,200 XLM
          ]),
        ],
        [
          3,
          new Map([
            [
              'GBK37RY6M2X4M74H5QZ3HY2A3EHL73LIV52AHP4R6Q3I4G4R4KZV2OTHER3',
              2000000000n,
            ], // 200 XLM
          ]),
        ],
      ]),
      eligibleProjects: new Set([1, 2, 3]),
    };
    this.rounds.set(activeRoundId, activeRound);

    // Round 1: Ended & Distributed round
    const endedRoundId = this.nextRoundId++;
    const endedRound: RoundRecord = {
      id: endedRoundId,
      name: 'Soroban Builders Grant - Round 2',
      tokenAddress: 'CBFQX3K5PZ...TESTNET',
      startTime: now - 20 * 24 * 3600, // 20 days ago
      endTime: now - 10 * 24 * 3600, // 10 days ago
      totalPool: 10000000000000n, // 1,000,000 XLM
      isFinalized: true,
      isDistributed: true,
      contributions: new Map([
        [
          2,
          new Map([
            [
              'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
              45000000000n,
            ], // 4,500 XLM
            [
              'GBK37RY6M2X4M74H5QZ3HY2A3EHL73LIV52AHP4R6Q3I4G4R4KZV2OTHER1',
              15000000000n,
            ], // 1,500 XLM
          ]),
        ],
        [
          4,
          new Map([
            [
              'GBK37RY6M2X4M74H5QZ3HY2A3EHL73LIV52AHP4R6Q3I4G4R4KZV2OTHER3',
              30000000000n,
            ], // 3,000 XLM
          ]),
        ],
      ]),
      eligibleProjects: new Set([2, 4]),
    };
    this.rounds.set(endedRoundId, endedRound);

    this.logger.log('Seeded 2 mock grant rounds in development mode');
  }

  // ── Round management ───────────────────────────────────────────────────────

  createRound(dto: CreateRoundDto): RoundDto {
    if (dto.endTime <= dto.startTime) {
      throw new BadRequestException('endTime must be after startTime');
    }

    const id = this.nextRoundId++;
    const record: RoundRecord = {
      id,
      name: dto.name,
      tokenAddress: dto.tokenAddress,
      startTime: dto.startTime,
      endTime: dto.endTime,
      totalPool: 0n,
      isFinalized: false,
      isDistributed: false,
      contributions: new Map(),
      eligibleProjects: new Set(),
    };
    this.rounds.set(id, record);
    this.logger.log(`Round ${id} created: ${dto.name}`);
    return this.toRoundDto(record);
  }

  getRound(roundId: number): RoundDto {
    return this.toRoundDto(this.getRecord(roundId));
  }

  listRounds(): RoundDto[] {
    return [...this.rounds.values()].map((r) => this.toRoundDto(r));
  }

  fundPool(dto: FundPoolDto): { roundId: number; newBalance: string } {
    const record = this.getRecord(dto.roundId);
    if (record.isFinalized) {
      throw new BadRequestException('Round is already finalized');
    }
    const amount = BigInt(dto.amount);
    if (amount <= 0n) throw new BadRequestException('Amount must be positive');

    record.totalPool += amount;
    this.logger.log(
      `Round ${dto.roundId} pool funded +${amount} by ${dto.funderPublicKey}`,
    );
    return { roundId: dto.roundId, newBalance: record.totalPool.toString() };
  }

  // ── Eligibility ────────────────────────────────────────────────────────────

  approveProject(dto: ApproveProjectDto): void {
    const record = this.getRecord(dto.roundId);
    if (record.isFinalized) {
      throw new BadRequestException('Round is already finalized');
    }
    if (record.eligibleProjects.has(dto.projectId)) {
      throw new BadRequestException('Project already eligible');
    }
    record.eligibleProjects.add(dto.projectId);
    if (!record.contributions.has(dto.projectId)) {
      record.contributions.set(dto.projectId, new Map());
    }
    this.logger.log(
      `Project ${dto.projectId} approved for round ${dto.roundId}`,
    );
  }

  removeProject(roundId: number, projectId: number): void {
    const record = this.getRecord(roundId);
    if (record.isFinalized) {
      throw new BadRequestException('Round is already finalized');
    }
    if (!record.eligibleProjects.has(projectId)) {
      throw new NotFoundException('Project not eligible in this round');
    }
    record.eligibleProjects.delete(projectId);
  }

  // ── Contribution recording ─────────────────────────────────────────────────

  recordContribution(dto: RecordContributionDto): void {
    const record = this.getRecord(dto.roundId);
    if (record.isFinalized) {
      throw new BadRequestException('Round is already finalized');
    }

    const now = Math.floor(Date.now() / 1000);
    if (now < record.startTime || now > record.endTime) {
      throw new BadRequestException('Round is not currently active');
    }

    if (!record.eligibleProjects.has(dto.projectId)) {
      throw new BadRequestException('Project is not eligible in this round');
    }

    const amount = BigInt(dto.amount);
    if (amount <= 0n) throw new BadRequestException('Amount must be positive');

    const projectContribs =
      record.contributions.get(dto.projectId) ?? new Map<string, bigint>();
    const prev = projectContribs.get(dto.contributorPublicKey) ?? 0n;
    projectContribs.set(dto.contributorPublicKey, prev + amount);
    record.contributions.set(dto.projectId, projectContribs);

    this.logger.log(
      `Contribution recorded: round=${dto.roundId} project=${dto.projectId} contributor=${dto.contributorPublicKey} amount=${amount}`,
    );
  }

  // ── Finalization ───────────────────────────────────────────────────────────

  finalizeRound(roundId: number): RoundDto {
    const record = this.getRecord(roundId);
    if (record.isFinalized) {
      throw new BadRequestException('Round already finalized');
    }
    const now = Math.floor(Date.now() / 1000);
    if (now <= record.endTime) {
      throw new BadRequestException('Round has not ended yet');
    }
    record.isFinalized = true;
    this.logger.log(`Round ${roundId} finalized`);
    return this.toRoundDto(record);
  }

  // ── QF calculation ─────────────────────────────────────────────────────────

  /**
   * Compute QF score for a project: (Σ sqrt(c_i))²
   * Uses integer square root with 1e9 fixed-point precision.
   */
  private computeQfScore(contributions: Map<string, bigint>): bigint {
    const SCALE = 1_000_000_000n;
    let sumSqrt = 0n;

    for (const amount of contributions.values()) {
      if (amount > 0n) {
        sumSqrt += this.sqrtScaled(amount, SCALE);
      }
    }

    // (sumSqrt / SCALE)^2
    const squared = sumSqrt * sumSqrt;
    return squared / (SCALE * SCALE);
  }

  private sqrtScaled(value: bigint, scale: bigint): bigint {
    if (value <= 0n) return 0n;
    if (value === 1n) return scale;

    let low = 0n;
    let high = value;
    while (low < high) {
      const mid = (low + high + 1n) / 2n;
      if (mid * mid <= value) {
        low = mid;
      } else {
        high = mid - 1n;
      }
    }

    const intPart = low * scale;
    const remainder =
      low > 0n ? ((value - low * low) * scale) / (2n * low) : 0n;
    return intPart + remainder;
  }
  private formatPercentage(part: bigint, total: bigint, decimals = 2): string {
    if (total === 0n) return `0.${'0'.repeat(decimals)}`;
    const scale = 10n ** BigInt(decimals);
    const value = (part * 100n * scale + total / 2n) / total;
    const integer = value / scale;
    const fraction = (value % scale).toString().padStart(decimals, '0');
    return `${integer}.${fraction}`;
  }

  private computeParticipationMetrics(
    record: RoundRecord,
  ): RoundParticipationMetricsDto {
    let totalContributionAmount = 0n;
    let totalContributionRecords = 0;
    let totalProjectsWithContributions = 0;
    const uniqueContributors = new Set<string>();

    for (const pid of record.eligibleProjects) {
      const contribs =
        record.contributions.get(pid) ?? new Map<string, bigint>();
      const projectTotal = [...contribs.values()].reduce(
        (a: bigint, b: bigint) => a + b,
        0n,
      );
      if (projectTotal > 0n) {
        totalProjectsWithContributions += 1;
      }
      totalContributionAmount += projectTotal;
      totalContributionRecords += contribs.size;
      for (const contributor of contribs.keys()) {
        uniqueContributors.add(contributor);
      }
    }

    return {
      totalContributors: uniqueContributors.size,
      totalContributionAmount: totalContributionAmount.toString(),
      totalContributionRecords,
      totalProjectsWithContributions,
      averageContributionPerContributor:
        uniqueContributors.size > 0
          ? (
              totalContributionAmount / BigInt(uniqueContributors.size)
            ).toString()
          : '0',
      averageContributionPerProject:
        totalProjectsWithContributions > 0
          ? (
              totalContributionAmount / BigInt(totalProjectsWithContributions)
            ).toString()
          : '0',
    };
  }

  private buildProjectAllocations(
    record: RoundRecord,
    scores: Map<number, bigint>,
    totalQf: bigint,
    totalContributionAmount: bigint,
  ): ProjectAllocationDto[] {
    const allocations: ProjectAllocationDto[] = [];

    for (const pid of record.eligibleProjects) {
      const contribs =
        record.contributions.get(pid) ?? new Map<string, bigint>();
      const score = scores.get(pid) ?? 0n;
      const totalContribs = [...contribs.values()].reduce(
        (a: bigint, b: bigint) => a + b,
        0n,
      );
      const estimatedMatch =
        totalQf > 0n && record.totalPool > 0n
          ? (record.totalPool * score) / totalQf
          : 0n;

      allocations.push({
        projectId: pid,
        qfScore: score.toString(),
        totalContributions: totalContribs.toString(),
        contributorCount: contribs.size,
        estimatedMatch: estimatedMatch.toString(),
        contributionPercentage: this.formatPercentage(
          totalContribs,
          totalContributionAmount,
        ),
        qfPercentage: this.formatPercentage(score, totalQf),
        allocationPercentage: this.formatPercentage(
          estimatedMatch,
          record.totalPool,
        ),
      });
    }

    allocations.sort((a, b) =>
      Number(BigInt(b.estimatedMatch) - BigInt(a.estimatedMatch)),
    );
    return allocations;
  }

  private buildContributionRecords(
    record: RoundRecord,
  ): ContributionRecordDto[] {
    const contributions: ContributionRecordDto[] = [];

    for (const pid of record.eligibleProjects) {
      const contribs =
        record.contributions.get(pid) ?? new Map<string, bigint>();
      for (const [contributorPublicKey, amount] of contribs.entries()) {
        contributions.push({
          projectId: pid,
          contributorPublicKey,
          amount: amount.toString(),
        });
      }
    }

    contributions.sort(
      (a, b) =>
        a.projectId - b.projectId ||
        a.contributorPublicKey.localeCompare(b.contributorPublicKey),
    );
    return contributions;
  }

  getRoundSummary(roundId: number): RoundSummaryDto {
    const record = this.getRecord(roundId);

    const scores = new Map<number, bigint>();
    let totalQf = 0n;

    for (const pid of record.eligibleProjects) {
      const contribs =
        record.contributions.get(pid) ?? new Map<string, bigint>();
      const score = this.computeQfScore(contribs);
      scores.set(pid, score);
      totalQf += score;
    }

    const participationMetrics = this.computeParticipationMetrics(record);
    const totalContributionAmount = BigInt(
      participationMetrics.totalContributionAmount,
    );
    const projects = this.buildProjectAllocations(
      record,
      scores,
      totalQf,
      totalContributionAmount,
    );

    return {
      round: this.toRoundDto(record),
      poolBalance: record.totalPool.toString(),
      participationMetrics,
      projects,
    };
  }

  /**
   * Return a ranked leaderboard of projects for a round.
   *
   * Projects are sorted by QF score descending (higher match = higher rank).
   * Supports top-N and paginated responses. Returns an empty entries list
   * when the round exists but has no eligible projects.
   *
   * @throws NotFoundException when the round does not exist.
   */
  getLeaderboard(query: LeaderboardQueryDto): LeaderboardResponseDto {
    const { roundId, topN, page = 1, limit = 10 } = query;
    const record = this.getRecord(roundId);

    const scores = new Map<number, bigint>();
    let totalQf = 0n;

    for (const pid of record.eligibleProjects) {
      const contribs = record.contributions.get(pid) ?? new Map<string, bigint>();
      const score = this.computeQfScore(contribs);
      scores.set(pid, score);
      totalQf += score;
    }

    // Build ranked entries sorted by QF score descending
    const allEntries: LeaderboardEntryDto[] = Array.from(scores.entries())
      .sort(([, a], [, b]) => (b > a ? 1 : b < a ? -1 : 0))
      .map(([projectId, score], index) => {
        const contribs = record.contributions.get(projectId) ?? new Map<string, bigint>();
        const totalContributions = Array.from(contribs.values()).reduce(
          (sum, v) => sum + v,
          0n,
        );
        const contributorCount = contribs.size;
        const estimatedMatch =
          totalQf > 0n
            ? (record.totalPool * score) / totalQf
            : 0n;
        const matchPercentage =
          totalQf > 0n
            ? ((score * 10000n) / totalQf).toString()
            : '0';

        return {
          rank: index + 1,
          projectId,
          totalContributions: totalContributions.toString(),
          contributorCount,
          qfScore: score.toString(),
          estimatedMatch: estimatedMatch.toString(),
          matchPercentage: (Number(matchPercentage) / 100).toFixed(2),
        };
      });

    const totalProjects = allEntries.length;

    // Apply top-N or pagination
    let entries: LeaderboardEntryDto[];
    let effectivePage: number;
    let effectiveLimit: number;

    if (topN !== undefined) {
      const cap = Math.min(topN, 100);
      entries = allEntries.slice(0, cap);
      effectivePage = 1;
      effectiveLimit = cap;
    } else {
      effectiveLimit = Math.min(limit, 100);
      effectivePage = page;
      const start = (effectivePage - 1) * effectiveLimit;
      entries = allEntries.slice(start, start + effectiveLimit);
    }

    return {
      round: this.toRoundDto(record),
      entries,
      totalProjects,
      poolBalance: record.totalPool.toString(),
      page: effectivePage,
      limit: effectiveLimit,
    };
  }

  getRoundExport(roundId: number): RoundExportDto {
    const summary = this.getRoundSummary(roundId);
    const record = this.getRecord(roundId);
    return {
      ...summary,
      contributions: this.buildContributionRecords(record),
    };
  }

  distribute(dto: DistributeDto): {
    totalDistributed: string;
    allocations: { projectId: number; owner: string; amount: string }[];
  } {
    const record = this.getRecord(dto.roundId);
    if (!record.isFinalized) {
      throw new BadRequestException(
        'Round must be finalized before distribution',
      );
    }
    if (record.isDistributed) {
      throw new BadRequestException(
        'Matching funds already distributed for this round',
      );
    }

    const eligibleList = [...record.eligibleProjects];
    if (eligibleList.length === 0) {
      throw new BadRequestException('No eligible projects in this round');
    }

    // Compute QF scores
    const scores = eligibleList.map((pid) => {
      const contribs =
        record.contributions.get(pid) ?? new Map<string, bigint>();
      return { pid, score: this.computeQfScore(contribs) };
    });

    const totalQf = scores.reduce((acc, s) => acc + s.score, 0n);
    if (totalQf === 0n) {
      throw new BadRequestException(
        'No contributions recorded — cannot distribute',
      );
    }

    const pool = record.totalPool;
    if (pool === 0n) {
      throw new BadRequestException('Matching pool is empty');
    }

    const allocations: { projectId: number; owner: string; amount: string }[] =
      [];
    let remainder = pool;

    scores.forEach(({ pid, score }, idx) => {
      const owner = dto.projectOwners[idx];
      if (!owner) return;

      const alloc =
        idx === scores.length - 1 ? remainder : (pool * score) / totalQf;

      if (idx !== scores.length - 1) remainder -= alloc;

      allocations.push({ projectId: pid, owner, amount: alloc.toString() });
    });

    record.isDistributed = true;
    record.totalPool = 0n;

    const totalDistributed = allocations
      .reduce((acc, a) => acc + BigInt(a.amount), 0n)
      .toString();

    this.logger.log(
      `Round ${dto.roundId} distributed ${totalDistributed} across ${allocations.length} projects`,
    );

    return { totalDistributed, allocations };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private getRecord(roundId: number): RoundRecord {
    const record = this.rounds.get(roundId);
    if (!record) throw new NotFoundException(`Round ${roundId} not found`);
    return record;
  }

  private toRoundDto(r: RoundRecord): RoundDto {
    const now = Math.floor(Date.now() / 1000);
    let status = 'ACTIVE';
    if (r.isDistributed) status = 'DISTRIBUTED';
    else if (r.isFinalized) status = 'FINALIZED';
    else if (now > r.endTime) status = 'ENDED';
    else if (now < r.startTime) status = 'PENDING';

    return {
      id: r.id,
      name: r.name,
      tokenAddress: r.tokenAddress,
      startTime: r.startTime,
      endTime: r.endTime,
      totalPool: r.totalPool.toString(),
      isFinalized: r.isFinalized,
      isDistributed: r.isDistributed,
      status,
    };
  }
}
