import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CastVoteDto,
  OverrideDto,
  ProjectVerificationDto,
  RegisterProjectDto,
  RegistryConfigDto,
  UpdateConfigDto,
  VerificationStatus,
  VoteResultDto,
  WeightMode,
} from './dto/verification.dto';

interface ProjectRecord {
  projectId: number;
  name: string;
  ownerPublicKey: string;
  status: VerificationStatus;
  votesFor: number;
  votesAgainst: number;
  registeredAt: number;
  resolvedAt: number;
  // voter -> weight cast
  votes: Map<string, { weight: number; support: boolean }>;
}

interface RegistryConfig {
  quorumThreshold: number;
  weightMode: WeightMode;
  minVoterWeight: number;
  // Simulated reputation store: publicKey -> score
  reputationStore: Map<string, number>;
  // Simulated token balance store: publicKey -> balance
  tokenBalanceStore: Map<string, number>;
}

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);
  private projects = new Map<number, ProjectRecord>();
  private config: RegistryConfig;

  constructor(private readonly configSvc: ConfigService) {
    this.config = {
      quorumThreshold: Number(this.configSvc.get('VERIFICATION_QUORUM', '100')),
      weightMode: this.configSvc.get(
        'VERIFICATION_WEIGHT_MODE',
        WeightMode.Reputation,
      ),
      minVoterWeight: Number(
        this.configSvc.get('VERIFICATION_MIN_WEIGHT', '1'),
      ),
      reputationStore: new Map(),
      tokenBalanceStore: new Map(),
    };
  }

  // ── Config ─────────────────────────────────────────────────────────────────

  getConfig(): RegistryConfigDto {
    return {
      quorumThreshold: this.config.quorumThreshold,
      weightMode: this.config.weightMode,
      minVoterWeight: this.config.minVoterWeight,
    };
  }

  updateConfig(dto: UpdateConfigDto): RegistryConfigDto {
    if (dto.quorumThreshold < 1) {
      throw new BadRequestException('quorumThreshold must be >= 1');
    }
    this.config.quorumThreshold = dto.quorumThreshold;
    this.config.minVoterWeight = dto.minVoterWeight;
    this.logger.log(
      `Config updated: quorum=${dto.quorumThreshold} minWeight=${dto.minVoterWeight}`,
    );
    return this.getConfig();
  }

  // ── Reputation / token seeding (for testing / on-chain sync) ──────────────

  /** Upsert a contributor's reputation score (synced from contributor_registry) */
  setReputation(publicKey: string, score: number): void {
    this.config.reputationStore.set(publicKey, score);
  }

  /** Upsert a voter's governance token balance (synced from chain) */
  setTokenBalance(publicKey: string, balance: number): void {
    this.config.tokenBalanceStore.set(publicKey, balance);
  }

  // ── Project registration ───────────────────────────────────────────────────

  registerProject(dto: RegisterProjectDto): ProjectVerificationDto {
    if (this.projects.has(dto.projectId)) {
      throw new BadRequestException(
        `Project ${dto.projectId} is already registered`,
      );
    }
    const record: ProjectRecord = {
      projectId: dto.projectId,
      name: dto.name,
      ownerPublicKey: dto.ownerPublicKey,
      status: VerificationStatus.Pending,
      votesFor: 0,
      votesAgainst: 0,
      registeredAt: Math.floor(Date.now() / 1000),
      resolvedAt: 0,
      votes: new Map(),
    };
    this.projects.set(dto.projectId, record);
    this.logger.log(`Project ${dto.projectId} registered for verification`);
    return this.toDto(record);
  }

  getProject(projectId: number): ProjectVerificationDto {
    return this.toDto(this.getRecord(projectId));
  }

  listProjects(status?: VerificationStatus): ProjectVerificationDto[] {
    return [...this.projects.values()]
      .filter((p) => !status || p.status === status)
      .map((p) => this.toDto(p));
  }

  isVerified(projectId: number): boolean {
    const record = this.projects.get(projectId);
    return record?.status === VerificationStatus.Verified;
  }

  // ── Voting ─────────────────────────────────────────────────────────────────

  castVote(dto: CastVoteDto): VoteResultDto {
    const record = this.getRecord(dto.projectId);

    if (record.status !== VerificationStatus.Pending) {
      throw new BadRequestException(
        `Project ${dto.projectId} is no longer accepting votes (status: ${record.status})`,
      );
    }

    if (record.votes.has(dto.voterPublicKey)) {
      throw new BadRequestException(
        `${dto.voterPublicKey} has already voted on project ${dto.projectId}`,
      );
    }

    const weight = this.resolveWeight(dto.voterPublicKey);
    if (weight < this.config.minVoterWeight) {
      throw new ForbiddenException(
        `Voter weight ${weight} is below minimum ${this.config.minVoterWeight}`,
      );
    }

    record.votes.set(dto.voterPublicKey, { weight, support: dto.support });

    if (dto.support) {
      record.votesFor += weight;
    } else {
      record.votesAgainst += weight;
    }

    // Auto-resolve
    if (record.votesFor >= this.config.quorumThreshold) {
      record.status = VerificationStatus.Verified;
      record.resolvedAt = Math.floor(Date.now() / 1000);
      this.logger.log(
        `Project ${dto.projectId} VERIFIED (votesFor=${record.votesFor})`,
      );
    } else if (record.votesAgainst >= this.config.quorumThreshold) {
      record.status = VerificationStatus.Rejected;
      record.resolvedAt = Math.floor(Date.now() / 1000);
      this.logger.log(
        `Project ${dto.projectId} REJECTED (votesAgainst=${record.votesAgainst})`,
      );
    }

    return {
      projectId: dto.projectId,
      voterPublicKey: dto.voterPublicKey,
      weight,
      support: dto.support,
      newStatus: record.status,
      votesFor: record.votesFor,
      votesAgainst: record.votesAgainst,
    };
  }

  // ── Admin override ─────────────────────────────────────────────────────────

  overrideVerification(dto: OverrideDto): ProjectVerificationDto {
    const record = this.getRecord(dto.projectId);
    record.status = dto.verified
      ? VerificationStatus.Verified
      : VerificationStatus.Rejected;
    record.resolvedAt = Math.floor(Date.now() / 1000);
    this.logger.log(
      `Project ${dto.projectId} overridden to ${record.status} by admin`,
    );
    return this.toDto(record);
  }

  // ── Weight resolution ──────────────────────────────────────────────────────

  private resolveWeight(publicKey: string): number {
    switch (this.config.weightMode) {
      case WeightMode.Reputation:
        return this.config.reputationStore.get(publicKey) ?? 0;
      case WeightMode.TokenBalance:
        return this.config.tokenBalanceStore.get(publicKey) ?? 0;
      case WeightMode.Flat:
        return 1;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private getRecord(projectId: number): ProjectRecord {
    const record = this.projects.get(projectId);
    if (!record) throw new NotFoundException(`Project ${projectId} not found`);
    return record;
  }

  private toDto(r: ProjectRecord): ProjectVerificationDto {
    const quorumProgress = Math.min(
      100,
      Math.round((r.votesFor / this.config.quorumThreshold) * 100),
    );
    return {
      projectId: r.projectId,
      name: r.name,
      ownerPublicKey: r.ownerPublicKey,
      status: r.status,
      votesFor: r.votesFor,
      votesAgainst: r.votesAgainst,
      registeredAt: r.registeredAt,
      resolvedAt: r.resolvedAt,
      quorumProgress,
    };
  }
}
