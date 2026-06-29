import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ContributeDto,
  ContributionRecordDto,
  ContributionResponseDto,
  ContributorDto,
  CreateProjectDto,
  CrowdfundProjectDto,
  OnChainStatus,
  RoadmapItemDto,
} from './dto/crowdfund.dto';
import { CrowdfundProjectEntity } from './entities/crowdfund-project.entity';
import { CrowdfundContributionEntity } from './entities/crowdfund-contribution.entity';
import { randomUUID } from 'crypto';

const STROOP = 10_000_000n; // 1 XLM in stroops

@Injectable()
export class CrowdfundService {
  private readonly logger = new Logger(CrowdfundService.name);

  constructor(
    @InjectRepository(CrowdfundProjectEntity)
    private readonly projectRepo: Repository<CrowdfundProjectEntity>,
    @InjectRepository(CrowdfundContributionEntity)
    private readonly contributionRepo: Repository<CrowdfundContributionEntity>,
  ) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  async listProjects(): Promise<CrowdfundProjectDto[]> {
    const projects = await this.projectRepo.find();
    return Promise.all(projects.map((p) => this.toDto(p)));
  }

  async getProject(id: number): Promise<CrowdfundProjectDto> {
    // For backward compatibility, find by id as string
    const project = await this.projectRepo.findOneBy({ id: String(id) });
    if (!project) {
      throw new NotFoundException(`Project ${id} not found`);
    }
    return this.toDto(project);
  }

  async createProject(dto: CreateProjectDto): Promise<CrowdfundProjectDto> {
    const projectId = randomUUID();
    const project = this.projectRepo.create({
      projectId,
      owner: dto.owner,
      name: dto.name,
      description: dto.description ?? null,
      bannerUrl: dto.bannerUrl ?? null,
      targetAmount: BigInt(
        Math.round(parseFloat(dto.targetAmount) * Number(STROOP)),
      ),
      tokenAddress: dto.tokenAddress,
      contractAddress: dto.contractAddress ?? null,
      totalDeposited: 0n,
      totalWithdrawn: 0n,
      onChainStatus: OnChainStatus.ACTIVE,
      lastLedgerSeq: 0,
      lastTxHash: null,
      roadmap: (dto.roadmap ?? []).map((item, idx) => ({
        id: String(idx + 1),
        title: item.title,
        description: item.description,
        targetDate: item.targetDate,
        isCompleted: false,
      })),
    });
    const saved = await this.projectRepo.save(project);
    this.logger.log(`Project ${saved.id} created: ${dto.name}`);
    return this.toDto(saved);
  }

  async contribute(dto: ContributeDto): Promise<ContributionResponseDto> {
    const project = await this.projectRepo.findOneBy({ id: String(dto.projectId) });
    if (!project) {
      throw new NotFoundException(`Project ${dto.projectId} not found`);
    }

    if (project.onChainStatus !== OnChainStatus.ACTIVE) {
      throw new BadRequestException(
        `Project is not accepting contributions (status: ${project.onChainStatus})`,
      );
    }

    const amount = BigInt(Math.round(parseFloat(dto.amount) * Number(STROOP)));
    if (amount <= 0n) throw new BadRequestException('Amount must be positive');

    const txHash = `0x${randomUUID().replace(/-/g, '')}`;
    const contribution = this.contributionRepo.create({
      projectId: project.projectId,
      contributor: dto.senderPublicKey,
      amount,
      txHash,
      ledgerSequence: Math.floor(Math.random() * 1_000_000) + 50_000_000,
      ledgerTimestamp: new Date(),
    });

    await this.contributionRepo.save(contribution);
    project.totalDeposited += amount;
    project.lastTxHash = txHash;
    project.lastLedgerSeq = contribution.ledgerSequence;
    await this.projectRepo.save(project);

    // Auto-complete if target reached
    if (project.totalDeposited >= project.targetAmount) {
      project.onChainStatus = OnChainStatus.COMPLETED;
      await this.projectRepo.save(project);
      this.logger.log(
        `Project ${project.id} reached funding goal — marked COMPLETED`,
      );
    }

    this.logger.log(
      `Contribution: project=${dto.projectId} from=${dto.senderPublicKey} amount=${dto.amount}`,
    );

    return {
      transactionHash: txHash,
      status: 'SUCCESS',
      ledger: contribution.ledgerSequence,
    };
  }

  async bootstrapDemoData(): Promise<{ projectIds: number[] }> {
    const demoProjects: CreateProjectDto[] = [
      {
        owner: 'GB5PY6YQF3OZ2IRPII7G3XVG6UJZYE5MVYC2EQNHW4KSYSSFYH7Y7QK3',
        name: 'Testnet Accelerator Grant',
        description:
          'A sample project to demonstrate grant funding workflows on testnet.',
        targetAmount: '20000',
        tokenAddress:
          'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        contractAddress:
          'CC6FLKVQZFWURX3P2G7W4D6A4WKE2N4ACWXL6DL5S5Z2JHVV7K72DT2J',
        roadmap: [
          {
            title: 'Launch grant portal',
            description: 'Open the testnet portal for grant submissions.',
            targetDate: '2026-07-01',
          },
          {
            title: 'Review proposals',
            description: 'Evaluate first round of grant applications.',
            targetDate: '2026-08-01',
          },
        ],
      },
      {
        owner: 'GC3RZOB25UVDYLK6B2ZHG2ZGFA25ZV3XCYKZMIKQWRIHJCBBHTC4J6AM',
        name: 'Stellar UX Workshop',
        description:
          'An event-focused project to build onboarding flows for developer communities.',
        targetAmount: '15000',
        tokenAddress:
          'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        contractAddress:
          'CCBM7YWZL3AG7F4S4TA7Q3X6UET7HJE26F2EQNOYGSZTVCDBZODHTVCD',
        roadmap: [
          {
            title: 'Finalize workshop curriculum',
            description:
              'Create learner-friendly content for Stellar onboarding.',
            targetDate: '2026-07-15',
          },
          {
            title: 'Host live demo sessions',
            description: 'Run workshops for testnet users and contributors.',
            targetDate: '2026-08-15',
          },
        ],
      },
      {
        owner: 'GDQJUTQYK2MQX2VGDR2FYWLIYAQIEGXTQVTFEMGH3PRXC7XMGZ3TQKQ',
        name: 'Mobile App Onboarding',
        description:
          'A proof-of-concept mobile onboarding experience for testnet contributors.',
        targetAmount: '12000',
        tokenAddress:
          'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        contractAddress:
          'CDRP4QZJFJDUGBMN35GGRQBIZSGD3CQZIJFM4CLHZLGQDGZQ3JKWFPQ',
      },
    ];

    const createdProjects = await Promise.all(
      demoProjects.map((p) => this.createProject(p)),
    );

    const projectIds = createdProjects.map((p) => parseInt(p.id));

    this.logger.log(
      `Bootstrapped ${projectIds.length} demo projects: ${projectIds.join(', ')}`,
    );

    return { projectIds };
  }

  async getContributors(projectId: number): Promise<ContributorDto[]> {
    const project = await this.projectRepo.findOneBy({ id: String(projectId) });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    const contributions = await this.contributionRepo.findBy({
      projectId: project.projectId,
    });

    // Group contributions by contributor
    const grouped = new Map<string, CrowdfundContributionEntity[]>();
    contributions.forEach((c) => {
      const list = grouped.get(c.contributor) ?? [];
      list.push(c);
      grouped.set(c.contributor, list);
    });

    return [...grouped.entries()].map(([publicKey, entries]) => {
      const total = entries.reduce((acc, e) => acc + e.amount, 0n);
      const last = entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      return {
        publicKey,
        totalContributed: this.fromStroops(total),
        contributionCount: entries.length,
        lastContributionAt: last.createdAt.toISOString(),
      };
    });
  }

  async getProjectBalance(projectId: number): Promise<{ balance: string }> {
    const project = await this.projectRepo.findOneBy({ id: String(projectId) });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    const balance = project.totalDeposited - project.totalWithdrawn;
    return { balance: this.fromStroops(balance) };
  }

  async getMyContributions(
    projectId: number,
    publicKey: string,
  ): Promise<ContributionRecordDto[]> {
    const project = await this.projectRepo.findOneBy({ id: String(projectId) });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    const contributions = await this.contributionRepo.findBy({
      projectId: project.projectId,
      contributor: publicKey,
    });

    return contributions.map((c) => ({
      projectId,
      contributor: publicKey,
      amount: this.fromStroops(c.amount),
      timestamp: (c.ledgerTimestamp ?? c.createdAt).toISOString(),
      transactionHash: c.txHash,
    }));
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private fromStroops(stroops: bigint): string {
    return (Number(stroops) / Number(STROOP)).toFixed(7);
  }

  private async toDto(p: CrowdfundProjectEntity): Promise<CrowdfundProjectDto> {
    // Calculate contributor count
    const contributorCount = await this.contributionRepo
      .createQueryBuilder('c')
      .where('c.projectId = :projectId', { projectId: p.projectId })
      .select('COUNT(DISTINCT c.contributor)', 'count')
      .getRawOne()
      .then((r) => parseInt(r.count, 10) || 0);

    return {
      id: parseInt(p.id), // Map UUID to numeric for backward compatibility
      owner: p.owner,
      name: p.name,
      description: p.description ?? undefined,
      bannerUrl: p.bannerUrl ?? undefined,
      targetAmount: this.fromStroops(p.targetAmount),
      tokenAddress: p.tokenAddress,
      contractAddress: p.contractAddress ?? undefined,
      totalDeposited: this.fromStroops(p.totalDeposited),
      totalWithdrawn: this.fromStroops(p.totalWithdrawn),
      isActive: p.onChainStatus === OnChainStatus.ACTIVE,
      onChainStatus: p.onChainStatus,
      lastSyncedAt: p.updatedAt.toISOString(),
      contributorCount,
      roadmap: p.roadmap as RoadmapItemDto[],
      createdAt: p.createdAt.toISOString(),
    };
  }
}
