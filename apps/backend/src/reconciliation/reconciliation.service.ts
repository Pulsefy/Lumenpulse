import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, IsNull, Repository } from 'typeorm';
import { PortfolioAsset } from '../portfolio/portfolio-asset.entity';
import { User } from '../users/entities/user.entity';
import { StellarBalanceService } from '../portfolio/stellar-balance.service';
import {
  DriftRecord,
  ReconciliationJob,
  ReconciliationStatus,
} from './entities/reconciliation-job.entity';
import { QueryProfilerService } from '../common/profiling/query-profiler.service';

/** Tolerance for floating-point drift (0.0000001 XLM) */
const DRIFT_THRESHOLD = 1e-7;

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    @InjectRepository(ReconciliationJob)
    private readonly jobRepo: Repository<ReconciliationJob>,
    @InjectRepository(PortfolioAsset)
    private readonly assetRepo: Repository<PortfolioAsset>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly stellarBalanceService: StellarBalanceService,
    private readonly profiler: QueryProfilerService,
  ) {}

  /**
   * Run a full reconciliation pass across all users with linked Stellar accounts.
   * Compares stored portfolio_assets against live Horizon balances, logs drift,
   * and repairs inconsistencies by updating the stored records.
   */
  async runReconciliation(
    triggeredBy = 'scheduled',
  ): Promise<ReconciliationJob> {
    return this.profiler.profile(
      async () => this.doRunReconciliation(triggeredBy),
      { label: 'ReconciliationService.runReconciliation', thresholdMs: 5000 },
    );
  }

  private async doRunReconciliation(
    triggeredBy = 'scheduled',
  ): Promise<ReconciliationJob> {
    const job = await this.jobRepo.save(
      this.jobRepo.create({
        triggeredBy,
        status: ReconciliationStatus.RUNNING,
      }),
    );

    this.logger.log(
      `Reconciliation job ${job.id} started (triggeredBy=${triggeredBy})`,
    );

    const driftDetails: DriftRecord[] = [];
    let usersProcessed = 0;
    let driftsDetected = 0;
    let driftsRepaired = 0;

    try {
      // Only process users that have a stellarPublicKey set
      const usersWithKey = await this.userRepo.find({
        where: { stellarPublicKey: Not(IsNull()) },
        select: ['id', 'stellarPublicKey'],
      });

      for (const user of usersWithKey) {
        try {
          const drifts = await this.reconcileUser(
            user.id,
            user.stellarPublicKey,
          );
          driftsDetected += drifts.length;
          driftsRepaired += drifts.filter((d) => d.repaired).length;
          driftDetails.push(...drifts);
          usersProcessed++;
        } catch (err) {
          this.logger.warn(
            `Reconciliation skipped for user ${user.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      job.status = ReconciliationStatus.COMPLETED;
    } catch (err) {
      job.status = ReconciliationStatus.FAILED;
      job.errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Reconciliation job ${job.id} failed: ${job.errorMessage}`,
      );
    }

    job.usersProcessed = usersProcessed;
    job.driftsDetected = driftsDetected;
    job.driftsRepaired = driftsRepaired;
    job.driftDetails = driftDetails.length > 0 ? driftDetails : null;
    job.finishedAt = new Date();

    const saved = await this.jobRepo.save(job);

    this.logger.log(
      `Reconciliation job ${job.id} finished — users=${usersProcessed}, drifts=${driftsDetected}, repaired=${driftsRepaired}`,
    );

    return saved;
  }

  /**
   * Compare stored portfolio_assets for one user against live Stellar balances.
   * Repairs any drifted records in-place.
   */
  private async reconcileUser(
    userId: string,
    publicKey: string,
  ): Promise<DriftRecord[]> {
    const [upstreamBalances, storedAssets] = await Promise.all([
      this.stellarBalanceService.getAccountBalances(publicKey),
      this.assetRepo.find({ where: { userId } }),
    ]);

    const drifts: DriftRecord[] = [];

    // Build a lookup map for stored assets: "ASSET_CODE:issuer|native" -> entity
    const storedMap = new Map<string, PortfolioAsset>();
    for (const asset of storedAssets) {
      storedMap.set(this.assetKey(asset.assetCode, asset.assetIssuer), asset);
    }

    // Check each upstream balance against stored
    for (const upstream of upstreamBalances) {
      const key = this.assetKey(upstream.assetCode, upstream.assetIssuer);
      const stored = storedMap.get(key);
      const upstreamAmt = parseFloat(upstream.balance);

      if (!stored) {
        // Asset exists on-chain but not in DB — insert it
        const newAsset = this.assetRepo.create({
          userId,
          assetCode: upstream.assetCode,
          assetIssuer: upstream.assetIssuer ?? undefined,
          amount: upstream.balance,
        });
        await this.assetRepo.save(newAsset);

        drifts.push({
          userId,
          assetCode: upstream.assetCode,
          assetIssuer: upstream.assetIssuer,
          storedAmount: '0',
          upstreamAmount: upstream.balance,
          delta: upstream.balance,
          repaired: true,
        });

        this.logger.warn(
          `[DRIFT] User ${userId}: ${upstream.assetCode} missing in DB — inserted ${upstream.balance}`,
        );
        continue;
      }

      const storedAmt = parseFloat(stored.amount);
      const delta = Math.abs(upstreamAmt - storedAmt);

      if (delta > DRIFT_THRESHOLD) {
        const drift: DriftRecord = {
          userId,
          assetCode: upstream.assetCode,
          assetIssuer: upstream.assetIssuer,
          storedAmount: stored.amount,
          upstreamAmount: upstream.balance,
          delta: delta.toFixed(8),
          repaired: false,
        };

        // Repair: update stored amount to match upstream
        stored.amount = upstream.balance;
        await this.assetRepo.save(stored);
        drift.repaired = true;

        drifts.push(drift);

        this.logger.warn(
          `[DRIFT] User ${userId}: ${upstream.assetCode} stored=${storedAmt} upstream=${upstreamAmt} delta=${delta.toFixed(8)} — repaired`,
        );
      }

      storedMap.delete(key);
    }

    // Any remaining stored assets have no upstream counterpart — zero them out
    for (const [, orphan] of storedMap) {
      const drift: DriftRecord = {
        userId,
        assetCode: orphan.assetCode,
        assetIssuer: orphan.assetIssuer,
        storedAmount: orphan.amount,
        upstreamAmount: '0',
        delta: orphan.amount,
        repaired: false,
      };

      orphan.amount = '0';
      await this.assetRepo.save(orphan);
      drift.repaired = true;

      drifts.push(drift);

      this.logger.warn(
        `[DRIFT] User ${userId}: ${orphan.assetCode} has no upstream balance — zeroed out`,
      );
    }

    return drifts;
  }

  private assetKey(code: string, issuer: string | null | undefined): string {
    return `${code}:${issuer ?? 'native'}`;
  }

  /** Return the N most recent reconciliation jobs */
  async getRecentJobs(limit = 20): Promise<ReconciliationJob[]> {
    return this.jobRepo.find({
      order: { startedAt: 'DESC' },
      take: limit,
    });
  }

  async getJobById(id: string): Promise<ReconciliationJob | null> {
    return this.jobRepo.findOne({ where: { id } });
  }
}
