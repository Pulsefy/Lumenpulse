import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CrowdfundService } from '../crowdfund/crowdfund.service';
import {
  BootstrapDemoDataDto,
  BootstrapResponseDto,
  CreatedDemoProjectDto,
} from './dto/bootstrap.dto';

/**
 * Service for bootstrapping demo data in testnet environments.
 * Provides controlled seeding of sample projects for testing and review.
 */
@Injectable()
export class BootstrapService {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly crowdfundService: CrowdfundService,
  ) {}

  /**
   * Check if bootstrap is enabled in the current environment.
   * Production environments should have this disabled via environment flag.
   */
  private isBootstrapEnabled(): boolean {
    const enabled = this.configService.get<boolean>('BOOTSTRAP_ENABLED', false);
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');

    // Explicitly prevent bootstrap in production
    if (nodeEnv === 'production' && !enabled) {
      return false;
    }

    return enabled || nodeEnv !== 'production';
  }

  /**
   * Generate a deterministic random number from a seed.
   * Useful for reproducible demo data generation.
   */
  private seededRandom(seed: string, index: number): number {
    const str = `${seed}${index}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash) / 2147483647; // Normalize to [0, 1]
  }

  /**
   * Create demo projects with realistic data.
   * Supports optional seeding for reproducible test data.
   */
  async bootstrapDemoData(
    dto: BootstrapDemoDataDto,
  ): Promise<BootstrapResponseDto> {
    // Security: Check if bootstrap is enabled
    if (!this.isBootstrapEnabled()) {
      this.logger.warn(
        'Bootstrap attempt in production or when BOOTSTRAP_ENABLED is false',
      );
      throw new ForbiddenException(
        'Demo data bootstrap is disabled in this environment',
      );
    }

    const seed = dto.seed || `demo-${Date.now()}`;
    const environment = this.configService.get<string>(
      'ENVIRONMENT',
      'development',
    );

    this.logger.log(
      `Bootstrapping demo data with seed: ${seed} in environment: ${environment}`,
    );

    const demoProjects = this.generateDemoProjects(seed);
    const createdProjects: CreatedDemoProjectDto[] = [];

    // Create each demo project
    for (const projectData of demoProjects) {
      try {
        const created = this.crowdfundService.createProject({
          owner: projectData.owner,
          name: projectData.name,
          description: projectData.description,
          bannerUrl: projectData.bannerUrl,
          targetAmount: projectData.targetAmount,
          tokenAddress: projectData.tokenAddress,
          contractAddress: projectData.contractAddress,
          roadmap: projectData.roadmap,
        });

        createdProjects.push({
          projectId: created.id,
          name: created.name,
          description: created.description || '',
          owner: created.owner,
          targetAmount: projectData.targetAmount,
          totalContributed: '0',
          status: created.onChainStatus,
          createdAt: created.createdAt.toISOString(),
        });

        this.logger.log(
          `Created demo project: ${created.name} (ID: ${created.id})`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to create demo project: ${projectData.name}`,
          error,
        );
      }
    }

    this.logger.log(`Bootstrap complete: ${createdProjects.length} projects`);

    return {
      success: true,
      projectsCreated: createdProjects.length,
      projects: createdProjects,
      environment,
      timestamp: new Date().toISOString(),
      message:
        `Bootstrap completed successfully. Created ${createdProjects.length} ` +
        'demo projects. Use the project IDs above for testing and verification.',
    };
  }

  /**
   * Generate a realistic set of demo projects.
   * Can be made deterministic by providing a seed.
   */
  private generateDemoProjects(
    seed: string,
  ): Array<{
    owner: string;
    name: string;
    description: string;
    bannerUrl: string;
    targetAmount: string;
    tokenAddress: string;
    contractAddress?: string;
    roadmap: Array<{
      title: string;
      description: string;
      targetDate: string;
    }>;
  }> {
    const demoOwners = [
      'GBRPYHIL2CI3WHZDTOOQFC6EB4LEGWRL3OHUBNRQRNYC5JLVXCW2KV4',
      'GBCCMW6JQ4H5KWVS5JYM7VL5JDLYLWYOQHVLSQNKLFP7VQKXNZTFUUV',
      'GBDLTLVTWKWVWL7NXLGGR2XMHTMXDBVZRG7EGCZJGMZRXQR4OQJF4YYK',
      'GCNQHH5EEEZUVYUWBVQKWJ7XMUZQ4HUHG4CRHUHHHF7GMMPQHKFQE4Q',
      'GBDVK3GBKN7WBLLYDQWJX34APZQFVOVLRCQ6IHKVJ5OZLHZKP3V344Z',
    ];

    const projects = [
      {
        name: 'Smart Contract Audit Services',
        description:
          'Professional security audit services for Soroban smart contracts. ' +
          'Comprehensive analysis to identify and mitigate vulnerabilities.',
        targetAmount: '1000',
        roadmap: [
          {
            title: 'Initial Audit Planning',
            description: 'Define scope and methodology',
            targetDate: '2026-06-30',
          },
          {
            title: 'Core Contract Review',
            description: 'In-depth review of contract logic',
            targetDate: '2026-07-31',
          },
          {
            title: 'Final Report & Recommendations',
            description: 'Deliver comprehensive audit report',
            targetDate: '2026-08-31',
          },
        ],
      },
      {
        name: 'Developer Tooling Enhancement',
        description:
          'Build improved SDKs and developer tools for Stellar ecosystem integration. ' +
          'Make it easier for developers to build applications.',
        targetAmount: '750',
        roadmap: [
          {
            title: 'SDK Architecture Design',
            description: 'Plan SDK structure and APIs',
            targetDate: '2026-06-15',
          },
          {
            title: 'Core SDK Implementation',
            description: 'Implement main SDK functionality',
            targetDate: '2026-07-30',
          },
          {
            title: 'Documentation & Examples',
            description: 'Create comprehensive guides and examples',
            targetDate: '2026-08-30',
          },
        ],
      },
      {
        name: 'Infrastructure Redundancy',
        description:
          'Deploy redundant infrastructure for improved system reliability ' +
          'and uptime guarantees.',
        targetAmount: '2000',
        roadmap: [
          {
            title: 'Infrastructure Assessment',
            description: 'Analyze current bottlenecks',
            targetDate: '2026-06-20',
          },
          {
            title: 'Redundancy Implementation',
            description: 'Deploy backup systems and failover',
            targetDate: '2026-08-15',
          },
          {
            title: 'Load Testing & Optimization',
            description: 'Test performance under high load',
            targetDate: '2026-09-30',
          },
        ],
      },
      {
        name: 'Community Education Program',
        description:
          'Establish comprehensive education program with workshops, tutorials, ' +
          'and certification paths for developers.',
        targetAmount: '500',
        roadmap: [
          {
            title: 'Curriculum Development',
            description: 'Create course content and materials',
            targetDate: '2026-07-15',
          },
          {
            title: 'Platform Setup',
            description: 'Build learning management platform',
            targetDate: '2026-08-15',
          },
          {
            title: 'Launch & Promotion',
            description: 'Launch program and recruit instructors',
            targetDate: '2026-09-15',
          },
        ],
      },
      {
        name: 'API Rate Limiting & Security Hardening',
        description:
          'Implement advanced rate limiting, DDoS protection, and security hardening measures.',
        targetAmount: '1200',
        roadmap: [
          {
            title: 'Security Assessment',
            description: 'Conduct security audit',
            targetDate: '2026-06-30',
          },
          {
            title: 'Protection Implementation',
            description: 'Deploy rate limiting and DDoS protection',
            targetDate: '2026-07-31',
          },
          {
            title: 'Testing & Deployment',
            description: 'Test and deploy to production',
            targetDate: '2026-08-31',
          },
        ],
      },
    ];

    // Assign owners deterministically based on seed
    return projects.map((proj, idx) => {
      const ownerIdx = Math.floor(
        this.seededRandom(seed, idx) * demoOwners.length,
      );
      return {
        owner: demoOwners[ownerIdx],
        ...proj,
        bannerUrl: `https://via.placeholder.com/600x300?text=${encodeURIComponent(proj.name)}`,
        tokenAddress:
          'CDLZEA4RTA3AOF7UBNTQHFRJ67BGGVXU7HPKV4BQ7BQLYJ7G4GQFZD2',
        contractAddress: undefined,
      };
    });
  }
}
