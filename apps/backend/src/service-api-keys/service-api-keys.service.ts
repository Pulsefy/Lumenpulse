import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import {
  CreateServiceApiKeyDto,
  SERVICE_API_KEY_SCOPES,
} from './dto/create-service-api-key.dto';
import { ServiceApiKey } from './entities/service-api-key.entity';

export interface ServiceApiKeySummary {
  id: string;
  consumerId: string;
  name: string | null;
  keyPrefix: string;
  scopes: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokedBy: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface IssuedServiceApiKey {
  key: string;
  apiKey: ServiceApiKeySummary;
}

@Injectable()
export class ServiceApiKeysService {
  private readonly logger = new Logger(ServiceApiKeysService.name);

  constructor(
    @InjectRepository(ServiceApiKey)
    private readonly apiKeys: Repository<ServiceApiKey>,
  ) {}

  async list(consumerId: string): Promise<ServiceApiKeySummary[]> {
    const keys = await this.apiKeys.find({
      where: { consumerId },
      order: { createdAt: 'DESC' },
    });
    return keys.map((key) => this.toSummary(key));
  }

  async issue(
    consumerId: string,
    dto: CreateServiceApiKeyDto,
    createdBy: string,
  ): Promise<IssuedServiceApiKey> {
    if (!dto || !Array.isArray(dto.scopes) || dto.scopes.length === 0) {
      throw new BadRequestException('At least one API key scope is required');
    }
    const scopes = [...new Set(dto.scopes)];
    if (scopes.some((scope) => !SERVICE_API_KEY_SCOPES.includes(scope))) {
      throw new BadRequestException(
        `Scopes must be one or more of: ${SERVICE_API_KEY_SCOPES.join(', ')}`,
      );
    }
    const normalizedConsumerId = consumerId.trim();
    if (!/^[a-zA-Z0-9._-]{1,120}$/.test(normalizedConsumerId)) {
      throw new BadRequestException('Invalid service consumer identifier');
    }
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('expiresAt must be in the future');
    }

    const key = `lp_sk_${randomBytes(32).toString('base64url')}`;
    const entity = this.apiKeys.create({
      consumerId: normalizedConsumerId,
      name: dto.name?.trim() || null,
      keyPrefix: key.slice(0, 16),
      keyHash: this.hash(key),
      scopes,
      expiresAt,
      revokedAt: null,
      createdBy,
      revokedBy: null,
      lastUsedAt: null,
    });
    const saved = await this.apiKeys.save(entity);
    this.logger.log(
      `Issued service API key ${saved.id} for consumer ${saved.consumerId} by admin ${createdBy}`,
    );
    return { key, apiKey: this.toSummary(saved) };
  }

  async rotate(
    consumerId: string,
    id: string,
    createdBy: string,
  ): Promise<IssuedServiceApiKey> {
    const current = await this.find(consumerId, id);
    if (
      current.revokedAt ||
      (current.expiresAt && current.expiresAt <= new Date())
    ) {
      throw new NotFoundException('Active service API key not found');
    }
    return this.issue(
      consumerId,
      {
        name: current.name ?? undefined,
        scopes: current.scopes as CreateServiceApiKeyDto['scopes'],
        expiresAt: current.expiresAt?.toISOString(),
      },
      createdBy,
    );
  }

  async revoke(
    consumerId: string,
    id: string,
    revokedBy: string,
  ): Promise<ServiceApiKeySummary> {
    const key = await this.find(consumerId, id);
    if (!key.revokedAt) {
      key.revokedAt = new Date();
      key.revokedBy = revokedBy;
      await this.apiKeys.save(key);
      this.logger.log(
        `Revoked service API key ${key.id} for consumer ${key.consumerId} by admin ${revokedBy}`,
      );
    }
    return this.toSummary(key);
  }

  async authenticateServiceToken(
    token: string,
  ): Promise<{ consumerId: string; scopes: string[] } | null> {
    const key = await this.apiKeys
      .createQueryBuilder('apiKey')
      .where('apiKey.keyHash = :keyHash', { keyHash: this.hash(token) })
      .andWhere('apiKey.revokedAt IS NULL')
      .andWhere('(apiKey.expiresAt IS NULL OR apiKey.expiresAt > now())')
      .getOne();
    if (!key) {
      return null;
    }
    await this.apiKeys.update(key.id, { lastUsedAt: new Date() });
    return { consumerId: key.consumerId, scopes: key.scopes };
  }

  private async find(consumerId: string, id: string): Promise<ServiceApiKey> {
    const key = await this.apiKeys.findOne({ where: { id, consumerId } });
    if (!key) {
      throw new NotFoundException('Service API key not found');
    }
    return key;
  }

  private hash(key: string): string {
    return createHash('sha256').update(key, 'utf8').digest('hex');
  }

  private toSummary(key: ServiceApiKey): ServiceApiKeySummary {
    return {
      id: key.id,
      consumerId: key.consumerId,
      name: key.name,
      keyPrefix: key.keyPrefix,
      scopes: key.scopes,
      expiresAt: key.expiresAt,
      revokedAt: key.revokedAt,
      revokedBy: key.revokedBy,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
    };
  }
}
