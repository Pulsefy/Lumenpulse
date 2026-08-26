import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindManyOptions } from 'typeorm';
import { ContractDeploymentManifest } from './entities/contract-deployment-manifest.entity';
import {
  CreateDeploymentManifestDto,
  UpdateDeploymentManifestDto,
  QueryDeploymentManifestDto,
  DeploymentManifestListResponseDto,
} from './dto/deployment-manifest.dto';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

@Injectable()
export class DeploymentManifestService implements OnModuleInit {
  private readonly logger = new Logger(DeploymentManifestService.name);

  constructor(
    @Optional()
    @InjectRepository(ContractDeploymentManifest)
    private readonly manifestRepo?: Repository<ContractDeploymentManifest>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedFromOnchainManifestIfEmpty();
  }

  /**
   * Seeds the database with default manifest from apps/onchain/testnet-manifest.json
   * if no manifests exist in the database.
   */
  async seedFromOnchainManifestIfEmpty(): Promise<void> {
    if (!this.manifestRepo) {
      return;
    }

    try {
      const count = await this.manifestRepo.count();
      if (count > 0) {
        return;
      }

      // Locate testnet-manifest.json
      const repoRoot = process.cwd();
      const candidatePaths = [
        resolve(repoRoot, 'apps/onchain/testnet-manifest.json'),
        resolve(repoRoot, '../onchain/testnet-manifest.json'),
        resolve(repoRoot, 'testnet-manifest.json'),
      ];

      const manifestPath = candidatePaths.find((p) => existsSync(p));
      if (!manifestPath) {
        this.logger.warn(
          'No testnet-manifest.json file found for initial seeding.',
        );
        return;
      }

      const content = readFileSync(manifestPath, 'utf8');
      const parsed = JSON.parse(content) as Record<string, unknown>;

      const environment =
        typeof parsed.network === 'string' ? parsed.network : 'testnet';
      const contracts = (parsed.contracts as Record<string, any>) ?? {};
      const metadata: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(parsed)) {
        if (key !== 'contracts' && key !== 'network') {
          metadata[key] = value;
        }
      }

      const seedManifest = this.manifestRepo.create({
        environment,
        version: 'v1.0.0-initial',
        contracts,
        metadata,
        isActive: true,
        createdBy: 'system-seed',
      });

      await this.manifestRepo.save(seedManifest);
      this.logger.log(
        `Seeded initial contract deployment manifest for environment: ${environment}`,
      );
    } catch (error) {
      this.logger.error('Failed to seed initial deployment manifest', error);
    }
  }

  /**
   * Create a new contract deployment manifest record.
   * If marked active (default true), sets existing active manifests in the same environment to inactive.
   */
  async create(
    dto: CreateDeploymentManifestDto,
    actorId?: string,
  ): Promise<ContractDeploymentManifest> {
    const environment = dto.environment || 'testnet';
    const shouldBeActive = dto.isActive !== false;

    if (!this.manifestRepo) {
      const dummy: ContractDeploymentManifest = {
        id: 'dummy-manifest-id',
        environment,
        version: dto.version || null,
        contracts: dto.contracts,
        metadata: dto.metadata || null,
        isActive: shouldBeActive,
        createdBy: actorId || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      return dummy;
    }

    if (shouldBeActive) {
      await this.manifestRepo.update(
        { environment, isActive: true },
        { isActive: false },
      );
    }

    const manifest = this.manifestRepo.create({
      environment,
      version: dto.version || null,
      contracts: dto.contracts,
      metadata: dto.metadata || null,
      isActive: shouldBeActive,
      createdBy: actorId || null,
    });

    return await this.manifestRepo.save(manifest);
  }

  /**
   * Query historical and current deployment manifest records.
   */
  async findAll(
    query: QueryDeploymentManifestDto,
  ): Promise<DeploymentManifestListResponseDto> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));

    if (!this.manifestRepo) {
      return { data: [], total: 0, page, limit };
    }

    const where: FindManyOptions<ContractDeploymentManifest>['where'] = {};

    if (query.environment) {
      (where as Record<string, unknown>).environment = query.environment;
    }
    if (query.isActive !== undefined) {
      (where as Record<string, unknown>).isActive = query.isActive;
    }

    const [data, total] = await this.manifestRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit };
  }

  /**
   * Get the active deployment manifest for a target environment.
   */
  async findActive(
    environment = 'testnet',
  ): Promise<ContractDeploymentManifest> {
    if (this.manifestRepo) {
      const active = await this.manifestRepo.findOne({
        where: { environment, isActive: true },
        order: { createdAt: 'DESC' },
      });

      if (active) {
        return active;
      }
    }

    // Fallback if no active manifest found in DB: attempt reading from apps/onchain/testnet-manifest.json
    try {
      const repoRoot = process.cwd();
      const manifestPath = resolve(
        repoRoot,
        'apps/onchain/testnet-manifest.json',
      );
      if (existsSync(manifestPath)) {
        const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<
          string,
          unknown
        >;
        const contracts = (parsed.contracts as Record<string, any>) ?? {};
        const network =
          typeof parsed.network === 'string' ? parsed.network : environment;
        const metadata: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(parsed)) {
          if (key !== 'contracts' && key !== 'network') {
            metadata[key] = value;
          }
        }

        return {
          id: 'fallback-file-manifest',
          environment: String(network),
          version: 'file-fallback',
          contracts,
          metadata,
          isActive: true,
          createdBy: 'system-file',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
    } catch (err) {
      this.logger.warn('Failed fallback read of testnet-manifest.json', err);
    }

    throw new NotFoundException(
      `No active deployment manifest found for environment '${environment}'`,
    );
  }

  /**
   * Find a specific manifest by ID.
   */
  async findOne(id: string): Promise<ContractDeploymentManifest> {
    if (!this.manifestRepo) {
      throw new NotFoundException(`Manifest with ID '${id}' not found`);
    }

    const manifest = await this.manifestRepo.findOne({ where: { id } });
    if (!manifest) {
      throw new NotFoundException(`Manifest with ID '${id}' not found`);
    }

    return manifest;
  }

  /**
   * Update an existing manifest record.
   */
  async update(
    id: string,
    dto: UpdateDeploymentManifestDto,
    actorId?: string,
  ): Promise<ContractDeploymentManifest> {
    const manifest = await this.findOne(id);

    if (dto.isActive === true && !manifest.isActive) {
      if (this.manifestRepo) {
        await this.manifestRepo.update(
          {
            environment: dto.environment || manifest.environment,
            isActive: true,
          },
          { isActive: false },
        );
      }
    }

    if (dto.environment) manifest.environment = dto.environment;
    if (dto.version !== undefined) manifest.version = dto.version;
    if (dto.contracts) manifest.contracts = dto.contracts;
    if (dto.metadata !== undefined) manifest.metadata = dto.metadata;
    if (dto.isActive !== undefined) manifest.isActive = dto.isActive;
    if (actorId) manifest.createdBy = actorId;

    if (this.manifestRepo) {
      return await this.manifestRepo.save(manifest);
    }
    return manifest;
  }

  /**
   * Delete a manifest record by ID.
   */
  async remove(id: string): Promise<void> {
    const manifest = await this.findOne(id);
    if (this.manifestRepo) {
      await this.manifestRepo.remove(manifest);
    }
  }
}
