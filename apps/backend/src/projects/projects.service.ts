import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In } from 'typeorm';
import { Project, ProjectStatus } from './entities/project.entity';
import {
  ProjectListQueryDto,
  ProjectListResponseDto,
  ProjectListItemDto,
  ProjectDetailDto,
  OnChainStateDto,
} from './dto/projects.dto';
import { StellarService } from '../stellar/stellar.service';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    private readonly stellarService: StellarService,
  ) {}

  async listProjects(
    query: ProjectListQueryDto,
  ): Promise<ProjectListResponseDto> {
    const {
      status,
      ownerPublicKey,
      category,
      tags,
      q,
      includeOnChain = true,
      limit = 20,
      offset = 0,
    } = query;

    const queryBuilder = this.projectRepository.createQueryBuilder('project');

    // Apply filters
    if (status) {
      queryBuilder.andWhere('project.status = :status', { status });
    }

    if (ownerPublicKey) {
      queryBuilder.andWhere('project.ownerPublicKey = :ownerPublicKey', {
        ownerPublicKey,
      });
    }

    if (category) {
      queryBuilder.andWhere('project.category = :category', { category });
    }

    if (tags) {
      const tagArray = tags.split(',').map((t) => t.trim());
      queryBuilder.andWhere('project.tags && :tags', { tags: tagArray });
    }

    if (q) {
      queryBuilder.andWhere(
        '(project.name ILIKE :q OR project.description ILIKE :q)',
        { q: `%${q}%` },
      );
    }

    // Get total count
    const total = await queryBuilder.getCount();

    // Apply pagination
    queryBuilder.skip(offset).take(limit);

    // Order by updated date descending
    queryBuilder.orderBy('project.updatedAt', 'DESC');

    const projects = await queryBuilder.getMany();

    // Transform to DTOs with optional on-chain state
    const items = await Promise.all(
      projects.map((project) => this.toListItemDto(project, includeOnChain)),
    );

    return {
      projects: items,
      total,
      limit,
      offset,
    };
  }

  async getProject(id: string): Promise<ProjectDetailDto> {
    const project = await this.projectRepository.findOne({
      where: { id },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    return this.toDetailDto(project);
  }

  async syncOnChainState(projectId: string): Promise<void> {
    const project = await this.projectRepository.findOne({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    if (!project.contractAddress) {
      this.logger.warn(
        `Project ${projectId} has no contract address, skipping sync`,
      );
      return;
    }

    try {
      // Fetch on-chain state from Stellar/Soroban
      const onChainState = await this.fetchOnChainState(project.contractAddress);

      // Update project with on-chain data
      project.totalFunding = onChainState.totalFunding;
      project.vaultBalance = onChainState.vaultBalance;
      project.contributorCount = onChainState.contributorCount;
      project.lastUpdatedLedger = onChainState.lastUpdatedLedger;

      // Update status based on expiry
      if (project.expiresAt && new Date() > project.expiresAt) {
        project.status = ProjectStatus.Expired;
      }

      await this.projectRepository.save(project);

      this.logger.log(`Synced on-chain state for project ${projectId}`);
    } catch (error) {
      this.logger.error(
        `Failed to sync on-chain state for project ${projectId}: ${error.message}`,
      );
      // Don't throw - allow the API to continue with cached data
    }
  }

  private async fetchOnChainState(
    contractAddress: string,
  ): Promise<{
    totalFunding: bigint;
    vaultBalance: bigint;
    contributorCount: number;
    lastUpdatedLedger: bigint;
  }> {
    // TODO: Integrate with actual Soroban RPC to fetch contract state
    // For now, return default values
    // This would typically call a Soroban contract to get:
    // - Total funding received
    // - Current vault balance
    // - Number of contributors
    // - Last ledger sequence

    // Placeholder implementation
    return {
      totalFunding: 0n,
      vaultBalance: 0n,
      contributorCount: 0,
      lastUpdatedLedger: 0n,
    };
  }

  private async toListItemDto(
    project: Project,
    includeOnChain: boolean,
  ): Promise<ProjectListItemDto> {
    const dto: ProjectListItemDto = {
      id: project.id,
      name: project.name,
      description: project.description,
      ownerPublicKey: project.ownerPublicKey,
      status: project.status,
      websiteUrl: project.websiteUrl,
      githubUrl: project.githubUrl,
      tags: project.tags,
      category: project.category,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      expiresAt: project.expiresAt,
      verifiedAt: project.verifiedAt,
    };

    if (includeOnChain) {
      dto.onChainState = this.toOnChainStateDto(project);
    }

    return dto;
  }

  private toDetailDto(project: Project): ProjectDetailDto {
    return {
      ...this.toListItemDto(project, true),
      metadata: project.metadata,
      onChainState: this.toOnChainStateDto(project),
    };
  }

  private toOnChainStateDto(project: Project): OnChainStateDto {
    return {
      contractAddress: project.contractAddress,
      totalFunding: project.totalFunding?.toString() || null,
      vaultBalance: project.vaultBalance?.toString() || null,
      contributorCount: project.contributorCount || null,
      lastUpdatedLedger: project.lastUpdatedLedger?.toString() || null,
    };
  }
}
