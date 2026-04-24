import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  RoundDto,
  ProjectQfDto,
  RoundSummaryDto,
  CreateRoundDto,
  FundPoolDto,
  ApproveProjectDto,
  RecordContributionDto,
  DistributeDto,
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

  constructor(private readonly config: ConfigService) {}

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

  getRoundSummary(roundId: number): RoundSummaryDto {
    const record = this.getRecord(roundId);

    // Compute all QF scores
    const scores = new Map<number, bigint>();
    let totalQf = 0n;

    for (const pid of record.eligibleProjects) {
      const contribs =
        record.contributions.get(pid) ?? new Map<string, bigint>();
      const score = this.computeQfScore(contribs);
      scores.set(pid, score);
      totalQf += score;
    }

    const projects: ProjectQfDto[] = [];

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

      projects.push({
        projectId: pid,
        qfScore: score.toString(),
        totalContributions: totalContribs.toString(),
        contributorCount: contribs.size,
        estimatedMatch: estimatedMatch.toString(),
      });
    }

    // Sort by estimated match descending
    projects.sort((a, b) =>
      Number(BigInt(b.estimatedMatch) - BigInt(a.estimatedMatch)),
    );

    return {
      round: this.toRoundDto(record),
      poolBalance: record.totalPool.toString(),
      projects,
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
