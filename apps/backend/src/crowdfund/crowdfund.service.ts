import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
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
import { randomUUID } from 'crypto';

interface ProjectRecord {
  id: number;
  owner: string;
  name: string;
  description?: string;
  bannerUrl?: string;
  targetAmount: bigint;
  tokenAddress: string;
  contractAddress?: string;
  totalDeposited: bigint;
  totalWithdrawn: bigint;
  onChainStatus: OnChainStatus;
  lastSyncedAt: Date;
  createdAt: Date;
  roadmap: RoadmapItemDto[];
  // publicKey -> ContributionEntry[]
  contributions: Map<string, ContributionEntry[]>;
}

interface ContributionEntry {
  amount: bigint;
  timestamp: Date;
  transactionHash: string;
}

const STROOP = 10_000_000n; // 1 XLM in stroops

@Injectable()
export class CrowdfundService {
  private readonly logger = new Logger(CrowdfundService.name);
  private projects = new Map<number, ProjectRecord>();
  private nextId = 1;

  constructor() {
    this.seedSampleProjects();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  listProjects(): CrowdfundProjectDto[] {
    return [...this.projects.values()].map((p) => this.toDto(p));
  }

  getProject(id: number): CrowdfundProjectDto {
    return this.toDto(this.findOrThrow(id));
  }

  createProject(dto: CreateProjectDto): CrowdfundProjectDto {
    const id = this.nextId++;
    const record: ProjectRecord = {
      id,
      owner: dto.owner,
      name: dto.name,
      description: dto.description,
      bannerUrl: dto.bannerUrl,
      targetAmount: BigInt(
        Math.round(parseFloat(dto.targetAmount) * Number(STROOP)),
      ),
      tokenAddress: dto.tokenAddress,
      contractAddress: dto.contractAddress,
      totalDeposited: 0n,
      totalWithdrawn: 0n,
      onChainStatus: OnChainStatus.ACTIVE,
      lastSyncedAt: new Date(),
      createdAt: new Date(),
      roadmap: (dto.roadmap ?? []).map((item, idx) => ({
        id: String(idx + 1),
        title: item.title,
        description: item.description,
        targetDate: item.targetDate,
        isCompleted: false,
      })),
      contributions: new Map(),
    };
    this.projects.set(id, record);
    this.logger.log(`Project ${id} created: ${dto.name}`);
    return this.toDto(record);
  }

  contribute(dto: ContributeDto): ContributionResponseDto {
    const project = this.findOrThrow(dto.projectId);

    if (project.onChainStatus !== OnChainStatus.ACTIVE) {
      throw new BadRequestException(
        `Project is not accepting contributions (status: ${project.onChainStatus})`,
      );
    }

    const amount = BigInt(Math.round(parseFloat(dto.amount) * Number(STROOP)));
    if (amount <= 0n) throw new BadRequestException('Amount must be positive');

    const txHash = `0x${randomUUID().replace(/-/g, '')}`;
    const entry: ContributionEntry = {
      amount,
      timestamp: new Date(),
      transactionHash: txHash,
    };

    const existing = project.contributions.get(dto.senderPublicKey) ?? [];
    existing.push(entry);
    project.contributions.set(dto.senderPublicKey, existing);
    project.totalDeposited += amount;
    project.lastSyncedAt = new Date();

    // Auto-complete if target reached
    if (project.totalDeposited >= project.targetAmount) {
      project.onChainStatus = OnChainStatus.COMPLETED;
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
      ledger: Math.floor(Math.random() * 1_000_000) + 50_000_000,
    };
  }

  bootstrapDemoData(): { projectIds: number[] } {
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
          'CA6FLKVQZFWURX3P2G7W4D6A4WKE2N4ACWXL6DL5S5Z2JHVV7K72DT2J',
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

    const projectIds = demoProjects.map(
      (project) => this.createProject(project).id,
    );

    this.logger.log(
      `Bootstrapped ${projectIds.length} demo projects: ${projectIds.join(', ')}`,
    );

    return { projectIds };
  }

  getContributors(projectId: number): ContributorDto[] {
    const project = this.findOrThrow(projectId);

    return [...project.contributions.entries()].map(([publicKey, entries]) => {
      const total = entries.reduce((acc, e) => acc + e.amount, 0n);
      const last = entries[entries.length - 1];
      return {
        publicKey,
        totalContributed: this.fromStroops(total),
        contributionCount: entries.length,
        lastContributionAt: last.timestamp.toISOString(),
      };
    });
  }

  getProjectBalance(projectId: number): { balance: string } {
    const project = this.findOrThrow(projectId);
    const balance = project.totalDeposited - project.totalWithdrawn;
    return { balance: this.fromStroops(balance) };
  }

  getMyContributions(
    projectId: number,
    publicKey: string,
  ): ContributionRecordDto[] {
    const project = this.findOrThrow(projectId);
    const entries = project.contributions.get(publicKey) ?? [];

    return entries.map((e) => ({
      projectId,
      contributor: publicKey,
      amount: this.fromStroops(e.amount),
      timestamp: e.timestamp.toISOString(),
      transactionHash: e.transactionHash,
    }));
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private findOrThrow(id: number): ProjectRecord {
    const record = this.projects.get(id);
    if (!record) throw new NotFoundException(`Project ${id} not found`);
    return record;
  }

  private fromStroops(stroops: bigint): string {
    return (Number(stroops) / Number(STROOP)).toFixed(7);
  }

  private toDto(p: ProjectRecord): CrowdfundProjectDto {
    const totalContribs = [...p.contributions.values()].reduce(
      (acc, entries) => acc + entries.length,
      0,
    );

    return {
      id: p.id,
      owner: p.owner,
      name: p.name,
      description: p.description,
      bannerUrl: p.bannerUrl,
      targetAmount: this.fromStroops(p.targetAmount),
      tokenAddress: p.tokenAddress,
      contractAddress: p.contractAddress,
      totalDeposited: this.fromStroops(p.totalDeposited),
      totalWithdrawn: this.fromStroops(p.totalWithdrawn),
      isActive: p.onChainStatus === OnChainStatus.ACTIVE,
      onChainStatus: p.onChainStatus,
      lastSyncedAt: p.lastSyncedAt.toISOString(),
      contributorCount: totalContribs,
      roadmap: p.roadmap,
      createdAt: p.createdAt.toISOString(),
    };
  }

  // ── Seed data ──────────────────────────────────────────────────────────────

  private seedSampleProjects() {
    const samples: CreateProjectDto[] = [
      {
        owner: 'GBYD6MQZFKGTX4XFNXMZPTBOHSXMCURJJR7JTXRLDTZBQ7IJQFZUWEJ',
        name: 'Lumenpulse Community Fund',
        description:
          'A community-governed fund to support open-source Stellar ecosystem tooling and developer education.',
        targetAmount: '50000',
        tokenAddress:
          'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        contractAddress:
          'CABL2E2NKLCQIRSF6BXVB4NLSDBNJ2QBFVGXNLGBMZFDWRQKQ7MWDKD',
        roadmap: [
          {
            title: 'Launch fundraiser',
            description: 'Deploy vault contract and open contributions.',
            targetDate: '2026-03-01',
          },
          {
            title: 'Distribute first tranche',
            description:
              'Allocate 50% of funds to approved grant applications.',
            targetDate: '2026-06-01',
          },
        ],
      },
      {
        owner: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGERWIH7IHSORJOT7LQQFKH',
        name: 'StellarBridge DEX Integration',
        description:
          'Building a cross-chain bridge between Stellar and EVM networks with a mobile-first UX.',
        targetAmount: '25000',
        tokenAddress:
          'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        contractAddress:
          'CBSXTJCDVNR4QSUVVNRPUOMXZUWUBEYZQQKDXIYWF2FNXLBOPSTXGAGK',
        roadmap: [
          {
            title: 'Testnet prototype',
            description:
              'Working bridge on Testnet with basic swap functionality.',
            targetDate: '2026-04-15',
          },
          {
            title: 'Security audit',
            description: 'Third-party audit of the Soroban bridge contracts.',
            targetDate: '2026-05-30',
          },
          {
            title: 'Mainnet launch',
            description: 'Public release of the bridge with full UI.',
            targetDate: '2026-07-01',
          },
        ],
      },
      {
        owner: 'GDQJUTQYK2MQX2VGDR2FYWLIYAQIEGXTQVTFEMGH3PRXC7XMGZ3TQKQ',
        name: 'Micro-Grants for African Devs',
        description:
          'Providing micro-grants up to $500 to African developers building on Stellar.',
        targetAmount: '10000',
        tokenAddress:
          'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        contractAddress:
          'CDRP4QZJFJDUGBMN35GGRQBIZSGD3CQZIJFM4CLHZLGQDGZQ3JKWFPQ',
      },
    ];

    // Seed with some pre-existing contributions so the list looks populated
    for (const s of samples) {
      const dto = this.createProject(s);
      const record = this.projects.get(dto.id)!;

      // Add a few synthetic contributions
      const synthetic = [
        {
          pk: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          amt: '500',
        },
        {
          pk: 'GBYD6MQZFKGTX4XFNXMZPTBOHSXMCURJJR7JTXRLDTZBQ7IJQFZUWEJ',
          amt: '1200',
        },
      ];

      for (const c of synthetic) {
        const amount = BigInt(Math.round(parseFloat(c.amt) * Number(STROOP)));
        const entries = record.contributions.get(c.pk) ?? [];
        entries.push({
          amount,
          timestamp: new Date(
            Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000,
          ),
          transactionHash: `0x${randomUUID().replace(/-/g, '')}`,
        });
        record.contributions.set(c.pk, entries);
        record.totalDeposited += amount;
      }

      record.lastSyncedAt = new Date();
    }

    // Mark third project as COMPLETED for variety
    const third = this.projects.get(3);
    if (third) {
      third.onChainStatus = OnChainStatus.COMPLETED;
      third.totalDeposited = third.targetAmount;
    }
  }
}
