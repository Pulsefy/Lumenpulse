import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CrowdfundVaultEventType,
  CrowdfundVaultEventStatus,
} from '../entities/crowdfund-vault-event.entity';
import { DeadLetterStatus } from '../entities/crowdfund-vault-dead-letter.entity';

export class SyncVaultDto {
  @IsString()
  vaultAddress!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  fromLedger?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  toLedger?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1000)
  limit?: number;
}

export class SyncVaultResponseDto {
  vaultAddress!: string;
  syncedFrom!: number;
  syncedTo!: number;
  eventsFound!: number;
  eventsProcessed!: number;
  status!: 'success' | 'partial' | 'failed';
  error?: string;
}

export class ListVaultEventsDto {
  @IsOptional()
  @IsString()
  vaultAddress?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsEnum(CrowdfundVaultEventType)
  eventType?: CrowdfundVaultEventType;

  @IsOptional()
  @IsEnum(CrowdfundVaultEventStatus)
  status?: CrowdfundVaultEventStatus;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  page?: number = 0;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  sortBy?: 'createdAt' | 'ledgerSequence' | 'processedAt' = 'createdAt';

  @IsOptional()
  @IsEnum(['ASC', 'DESC'])
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}

export class VaultEventResponseDto {
  id!: string;
  transactionHash!: string;
  eventIndex!: number;
  vaultAddress!: string;
  projectId?: string;
  eventType!: CrowdfundVaultEventType;
  ledgerSequence!: number;
  ledgerClosedAt!: Date;
  normalizedData?: Record<string, unknown>;
  status!: CrowdfundVaultEventStatus;
  processingAttempts!: number;
  lastErrorMessage?: string;
  processedAt?: Date;
  createdAt!: Date;
}

export class DeadLetterListDto {
  @IsOptional()
  @IsString()
  vaultAddress?: string;

  @IsOptional()
  @IsEnum(DeadLetterStatus)
  status?: DeadLetterStatus;

  @IsOptional()
  @IsEnum(CrowdfundVaultEventType)
  eventType?: CrowdfundVaultEventType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  page?: number = 0;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  sortBy?: 'createdAt' | 'failureCount' | 'updatedAt' = 'createdAt';

  @IsOptional()
  @IsEnum(['ASC', 'DESC'])
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}

export class ReplayDeadLetterDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ResolveDeadLetterDto {
  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  resolvedBy?: string;
}

export class DeadLetterStatsResponseDto {
  total!: number;
  pending!: number;
  replayed!: number;
  resolved!: number;
  mostCommonError?: string;
  oldestUnresolvedAt?: Date;
  byVault?: Record<string, number>;
}

export class ReplayResponseDto {
  message!: string;
  jobId!: string;
  eventId!: string;
  replayCount!: number;
}

export class VaultSyncStatsDto {
  vaultAddress!: string;
  lastLedgerSequence!: number;
  safeLedgerSequence!: number;
  totalEvents!: number;
  pendingEvents!: number;
  failedEvents!: number;
  processedEvents!: number;
  lastSyncedAt?: Date;
  consecutiveFailures!: number;
}
