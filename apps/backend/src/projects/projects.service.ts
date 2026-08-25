import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectRegistryEntity } from '../database/entities/project-registry.entity';
import { CacheService } from '../cache/cache.service';
import { MetricsService } from '../metrics/metrics.service';
import { SorobanRpcClientService } from '../stellar/services/soroban-rpc-client.service';
import {
  ProjectListQueryDto,
  ProjectListItemDto,
  ProjectDetailDto,
  ProjectListResponseDto,
  ProjectStatus,
  OnChainStatusDto,
  ProjectMetadataDto,
} from './dto/projects.dto';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    @InjectRepository(ProjectRegistryEntity)
    private readonly projectRepository: Repository<ProjectRegistryEntity>,
    private readonly cacheService: CacheService,
    private readonly metricsService: MetricsService,
    private readonly sorobanRpc: SorobanRpcClientService,
  ) {}

  /**
   * Get paginated list of projects with on-chain status
   */
  async listProjects(
    query: ProjectListQueryDto,
  ): Promise<ProjectListResponseDto> {
    const startTime = Date.now();

    try {
      const {
        page = 1,
        limit = 10,
        status,
        owner,
        sortBy = 'createdAt',
        sortOrder = 'DESC',
      } = query;
      const skip = (page - 1) * limit;

      // Build query conditions
      const where: Record<string, unknown> = {};
      if (status) {
        where.status = status;
      }
      if (owner) {
        where.owner = owner;
      }

      // Execute query with pagination
      const [projects, total] = await this.projectRepository.findAndCount({
        where,
        order: { [sortBy]: sortOrder },
        skip,
        take: limit,
      });

      // Fetch on-chain state for each project
      const projectItems = await Promise.all(
        projects.map((project) => this.enrichProjectWithOnChainState(project)),
      );

      const response: ProjectListResponseDto = {
        projects: projectItems,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };

      const duration = Date.now() - startTime;
      this.metricsService.recordHistogram(
        'projects_list_duration_ms',
        duration,
      );
      this.logger.log(`Listed ${projects.length} projects in ${duration}ms`);

      return response;
    } catch (error) {
      this.logger.error('Error listing projects:', error);
      this.metricsService.incrementCounter('projects_list_errors_total');
      throw error;
    }
  }

  /**
   * Get detailed project information with on-chain state
   */
  async getProjectDetail(projectId: string): Promise<ProjectDetailDto> {
    const startTime = Date.now();

    try {
      const project = await this.projectRepository.findOne({
        where: { projectId },
      });

      if (!project) {
        throw new NotFoundException(`Project ${projectId} not found`);
      }

      const detail = await this.enrichProjectDetail(project);

      const duration = Date.now() - startTime;
      this.metricsService.recordHistogram(
        'projects_detail_duration_ms',
        duration,
      );
      this.logger.log(`Fetched project ${projectId} detail in ${duration}ms`);

      return detail;
    } catch (error) {
      this.logger.error(`Error fetching project ${projectId}:`, error);
      this.metricsService.incrementCounter('projects_detail_errors_total');
      throw error;
    }
  }

  /**
   * Enrich project with on-chain state using cache
   */
  private async enrichProjectWithOnChainState(
    project: ProjectRegistryEntity,
  ): Promise<ProjectListItemDto> {
    try {
      const onChainState = await this.fetchOnChainState(project.projectId);

      return {
        projectId: project.projectId,
        owner: project.owner,
        metadata: this.parseMetadata(project),
        onChainStatus: onChainState,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to fetch on-chain state for project ${project.projectId}:`,
        error,
      );
      // Return with default on-chain state if fetch fails
      return {
        projectId: project.projectId,
        owner: project.owner,
        metadata: this.parseMetadata(project),
        onChainStatus: this.getDefaultOnChainState(project),
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
    }
  }

  /**
   * Enrich project detail with full on-chain and off-chain information
   */
  private async enrichProjectDetail(
    project: ProjectRegistryEntity,
  ): Promise<ProjectDetailDto> {
    try {
      const onChainState = await this.fetchOnChainState(project.projectId);

      return {
        projectId: project.projectId,
        owner: project.owner,
        metadata: this.parseMetadata(project),
        onChainStatus: onChainState,
        metadataCid: project.metadataCid || '',
        contractAddress: project.contractAddress || undefined,
        tokenAddress: project.tokenAddress || undefined,
        targetAmount: project.targetAmount || undefined,
        milestones: [],
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to fetch on-chain state for project ${project.projectId}:`,
        error,
      );
      return {
        projectId: project.projectId,
        owner: project.owner,
        metadata: this.parseMetadata(project),
        onChainStatus: this.getDefaultOnChainState(project),
        metadataCid: project.metadataCid || '',
        contractAddress: project.contractAddress || undefined,
        tokenAddress: project.tokenAddress || undefined,
        targetAmount: project.targetAmount || undefined,
        milestones: [],
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
    }
  }

  /**
   * Fetch on-chain state from contract with caching
   */
  private async fetchOnChainState(
    projectId: string,
  ): Promise<OnChainStatusDto> {
    return this.cacheService.getContractReadCached(
      projectId,
      'get_vault_state',
      {},
      () => Promise.resolve(this.simulateOnChainState(projectId)),
    );
  }

  /**
   * Simulate on-chain state (replace with actual contract call)
   */
  private simulateOnChainState(projectId: string): OnChainStatusDto {
    // This would be replaced with actual Soroban contract calls
    // using the SorobanRpcClientService to read contract state

    return {
      status: ProjectStatus.ACTIVE,
      vault: {
        totalDeposited: '10000000000', // 1000 XLM in stroops
        totalWithdrawn: '5000000000', // 500 XLM in stroops
        currentBalance: '5000000000', // 500 XLM in stroops
        contributorCount: 42,
        lastLedgerSeq: 12345678,
      },
      lastTxHash: '0x' + Buffer.from(projectId).toString('hex').padEnd(64, '0'),
      lastSyncedAt: new Date(),
    };
  }

  /**
   * Get default on-chain state when contract is unavailable
   */
  private getDefaultOnChainState(
    project: ProjectRegistryEntity,
  ): OnChainStatusDto {
    return {
      status: project.status as ProjectStatus,
      vault: {
        totalDeposited: '0',
        totalWithdrawn: '0',
        currentBalance: '0',
        contributorCount: 0,
        lastLedgerSeq: project.lastLedgerSeq,
      },
      lastTxHash: project.lastTxHash,
      lastSyncedAt: project.updatedAt,
    };
  }

  /**
   * Parse project metadata from entity
   */
  private parseMetadata(project: ProjectRegistryEntity): ProjectMetadataDto {
    // In a real implementation, this would fetch and parse metadata from IPFS
    // using the metadataCid field

    return {
      name: project.name,
      description: `Description for ${project.name}`,
      bannerUrl: undefined,
      category: 'crowdfund',
      tags: ['stellar', 'crowdfund'],
      websiteUrl: undefined,
      socialLinks: {},
    };
  }

  /**
   * Invalidate cache for a specific project
   */
  async invalidateProjectCache(projectId: string): Promise<void> {
    await this.cacheService.invalidateContractById(projectId);
    this.logger.log(`Invalidated cache for project ${projectId}`);
  }

  /**
   * Health check for projects service
   */
  async healthCheck(): Promise<{
    status: string;
    database: boolean;
    cache: boolean;
  }> {
    const dbHealth = await this.checkDatabaseHealth();
    const cacheHealth = await this.cacheService.checkHealth();

    return {
      status: dbHealth && cacheHealth ? 'healthy' : 'unhealthy',
      database: dbHealth,
      cache: cacheHealth,
    };
  }

  private async checkDatabaseHealth(): Promise<boolean> {
    try {
      await this.projectRepository.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
