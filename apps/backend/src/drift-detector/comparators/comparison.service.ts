import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, IsNull, Repository, LessThan } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { StellarAccount } from '../../users/entities/stellar-account.entity';
import { PortfolioAsset } from '../../portfolio/portfolio-asset.entity';
import { ProjectRegistryEntity } from '../../database/entities/project-registry.entity';
import { DriftSuppression } from '../entities/drift-suppression.entity';
import { ChainFetcherService } from '../fetchers/chain-fetcher.service';
import {
  DriftRecord,
  DriftType,
  DriftSeverity,
  PortfolioAssetOnChain,
} from '../interfaces/drift.types';

const DRIFT_THRESHOLD = 1e-7;

@Injectable()
export class ComparisonService {
  private readonly logger = new Logger(ComparisonService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(StellarAccount)
    private readonly stellarAccountRepo: Repository<StellarAccount>,
    @InjectRepository(PortfolioAsset)
    private readonly assetRepo: Repository<PortfolioAsset>,
    @InjectRepository(ProjectRegistryEntity)
    private readonly projectRepo: Repository<ProjectRegistryEntity>,
    @InjectRepository(DriftSuppression)
    private readonly suppressionRepo: Repository<DriftSuppression>,
    private readonly chainFetcher: ChainFetcherService,
  ) {}

  async compareAllUsers(): Promise<DriftRecord[]> {
    const drifts: DriftRecord[] = [];
    const suppressions = await this.loadActiveSuppressions();

    const usersWithKey = await this.userRepo.find({
      where: { stellarPublicKey: Not(IsNull()) },
      select: ['id', 'stellarPublicKey'],
    });

    for (const user of usersWithKey) {
      try {
        const userDrifts = await this.compareUser(user.id, user.stellarPublicKey);
        drifts.push(...userDrifts);
      } catch (err) {
        this.logger.warn(
          `Drift check skipped for user ${user.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return this.filterSuppressed(drifts, suppressions);
  }

  async compareUser(userId: string, stellarPublicKey: string): Promise<DriftRecord[]> {
    const drifts: DriftRecord[] = [];

    const chain = await this.chainFetcher.fetchAccount(stellarPublicKey);

    if (!chain.exists) {
      drifts.push({
        entityType: 'User',
        entityId: userId,
        field: 'stellarPublicKey',
        driftType: DriftType.MISSING_ON_CHAIN,
        severity: DriftSeverity.HIGH,
        storedValue: stellarPublicKey,
        onChainValue: null,
        detail: `User ${userId} has stellarPublicKey ${stellarPublicKey} but no on-chain account exists`,
      });

      return drifts;
    }

    const storedAssets = await this.assetRepo.find({ where: { userId } });
    const storedMap = new Map<string, PortfolioAsset>();
    for (const asset of storedAssets) {
      storedMap.set(this.assetKey(asset.assetCode, asset.assetIssuer), asset);
    }

    for (const upstream of chain.balances) {
      const key = this.assetKey(upstream.assetCode, upstream.assetIssuer);
      const stored = storedMap.get(key);
      const upstreamAmt = parseFloat(upstream.balance);

      if (!stored) {
        drifts.push({
          entityType: 'PortfolioAsset',
          entityId: userId,
          field: 'amount',
          driftType: DriftType.MISSING_IN_BACKEND,
          severity: DriftSeverity.CRITICAL,
          storedValue: null,
          onChainValue: upstream.balance,
          detail: `Asset ${upstream.assetCode} exists on-chain with balance ${upstream.balance} but has no backend record for user ${userId}`,
        });
        continue;
      }

      const storedAmt = parseFloat(stored.amount);
      const delta = Math.abs(upstreamAmt - storedAmt);

      if (delta > DRIFT_THRESHOLD) {
        drifts.push({
          entityType: 'PortfolioAsset',
          entityId: stored.id,
          field: 'amount',
          driftType: DriftType.BALANCE_MISMATCH,
          severity: DriftSeverity.CRITICAL,
          storedValue: stored.amount,
          onChainValue: upstream.balance,
          detail: `User ${userId} asset ${upstream.assetCode}: backend=${stored.amount} on-chain=${upstream.balance} delta=${delta.toFixed(8)}`,
        });
      }

      storedMap.delete(key);
    }

    for (const [, orphan] of storedMap) {
      drifts.push({
        entityType: 'PortfolioAsset',
        entityId: orphan.id,
        field: 'amount',
        driftType: DriftType.MISSING_ON_CHAIN,
        severity: DriftSeverity.CRITICAL,
        storedValue: orphan.amount,
        onChainValue: '0',
        detail: `User ${userId} has backend record for ${orphan.assetCode}=${orphan.amount} but no on-chain balance exists`,
      });
    }

    const stellarAccounts = await this.stellarAccountRepo.find({
      where: { userId },
    });

    for (const account of stellarAccounts) {
      const accountExists = await this.chainFetcher.checkAccountExists(account.publicKey);
      if (!accountExists && account.isActive) {
        drifts.push({
          entityType: 'StellarAccount',
          entityId: account.id,
          field: 'isActive',
          driftType: DriftType.MISSING_ON_CHAIN,
          severity: DriftSeverity.HIGH,
          storedValue: true,
          onChainValue: false,
          detail: `StellarAccount ${account.publicKey} is marked active in backend but no on-chain account exists`,
        });
      }
    }

    return drifts;
  }

  async compareProjectRegistry(): Promise<DriftRecord[]> {
    const drifts: DriftRecord[] = [];
    const suppressions = await this.loadActiveSuppressions();
    const projects = await this.projectRepo.find();

    for (const project of projects) {
      try {
        const onChain = await this.chainFetcher.fetchProjectRegistry(project.projectId);

        if (!onChain) {
          drifts.push({
            entityType: 'ProjectRegistryEntity',
            entityId: project.id,
            field: 'projectId',
            driftType: DriftType.MISSING_ON_CHAIN,
            severity: DriftSeverity.MEDIUM,
            storedValue: project.projectId,
            onChainValue: null,
            detail: `Project ${project.projectId} exists in backend but on-chain contract returned no data`,
          });
          continue;
        }

        if (project.owner !== onChain.owner && onChain.owner) {
          drifts.push({
            entityType: 'ProjectRegistryEntity',
            entityId: project.id,
            field: 'owner',
            driftType: DriftType.FIELD_MISMATCH,
            severity: DriftSeverity.HIGH,
            storedValue: project.owner,
            onChainValue: onChain.owner,
            detail: `Project ${project.projectId} owner mismatch: backend=${project.owner} on-chain=${onChain.owner}`,
          });
        }

        if (project.status !== onChain.status && onChain.status !== 'unknown') {
          drifts.push({
            entityType: 'ProjectRegistryEntity',
            entityId: project.id,
            field: 'status',
            driftType: DriftType.STATUS_MISMATCH,
            severity: DriftSeverity.MEDIUM,
            storedValue: project.status,
            onChainValue: onChain.status,
            detail: `Project ${project.projectId} status mismatch: backend=${project.status} on-chain=${onChain.status}`,
          });
        }
      } catch (err) {
        this.logger.warn(
          `Project registry comparison failed for ${project.projectId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return this.filterSuppressed(drifts, suppressions);
  }

  private async loadActiveSuppressions(): Promise<Set<string>> {
    const active = await this.suppressionRepo.find({
      where: [
        { expiresAt: Not(IsNull()) as any },
        { expiresAt: LessThan(new Date()) },
      ].length > 0
        ? []
        : undefined,
    });

    const now = new Date();
    const all = await this.suppressionRepo.find();
    const set = new Set<string>();
    for (const s of all) {
      if (s.expiresAt && s.expiresAt < now) continue;
      set.add(`${s.entityType}:${s.entityId}:${s.field}`);
    }
    return set;
  }

  private filterSuppressed(
    drifts: DriftRecord[],
    suppressed: Set<string>,
  ): DriftRecord[] {
    return drifts.filter(
      (d) => !suppressed.has(`${d.entityType}:${d.entityId}:${d.field}`),
    );
  }

  async countCandidates(): Promise<{ usersWithKeys: number; projects: number }> {
    const [usersWithKeys, projects] = await Promise.all([
      this.userRepo.count({
        where: { stellarPublicKey: Not(IsNull()) },
      }),
      this.projectRepo.count(),
    ]);
    return { usersWithKeys, projects };
  }

  private assetKey(code: string, issuer: string | null | undefined): string {
    return `${code}:${issuer ?? 'native'}`;
  }
}
