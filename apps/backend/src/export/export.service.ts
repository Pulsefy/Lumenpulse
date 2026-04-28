import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ExportJob,
  ExportStatus,
  ExportType,
} from './entities/export-job.entity';
import { PortfolioSnapshot } from '../portfolio/entities/portfolio-snapshot.entity';
import { TransactionService } from '../transaction/transaction.service';

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    @InjectRepository(ExportJob)
    private readonly exportJobRepo: Repository<ExportJob>,
    @InjectRepository(PortfolioSnapshot)
    private readonly snapshotRepo: Repository<PortfolioSnapshot>,
    private readonly transactionService: TransactionService,
  ) {}

  async createExportJob(userId: string, type: ExportType): Promise<ExportJob> {
    const job = this.exportJobRepo.create({ userId, type });
    const saved = await this.exportJobRepo.save(job);

    // Process asynchronously — do not await
    this.processJob(saved.id, userId, type).catch((err: unknown) => {
      this.logger.error(
        `Export job ${saved.id} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    return saved;
  }

  async getJob(id: string, userId: string): Promise<ExportJob> {
    const job = await this.exportJobRepo.findOne({ where: { id, userId } });
    if (!job) throw new NotFoundException(`Export job ${id} not found`);
    return job;
  }

  async listJobs(userId: string): Promise<ExportJob[]> {
    return this.exportJobRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 20,
    });
  }

  private async processJob(
    jobId: string,
    userId: string,
    type: ExportType,
  ): Promise<void> {
    await this.exportJobRepo.update(jobId, { status: ExportStatus.PROCESSING });

    try {
      const csv =
        type === ExportType.PORTFOLIO_HISTORY
          ? await this.buildPortfolioHistoryCsv(userId)
          : await this.buildTaxTransactionsCsv(userId);

      await this.exportJobRepo.update(jobId, {
        status: ExportStatus.COMPLETED,
        csvData: csv,
      });

      this.logger.log(`Export job ${jobId} completed`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await this.exportJobRepo.update(jobId, {
        status: ExportStatus.FAILED,
        errorMessage: message,
      });
      throw err;
    }
  }

  private async buildPortfolioHistoryCsv(userId: string): Promise<string> {
    const snapshots = await this.snapshotRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    const rows = [
      'snapshot_id,date,asset_code,asset_issuer,amount,value_usd,total_portfolio_usd',
    ];

    for (const snap of snapshots) {
      for (const asset of snap.assetBalances) {
        rows.push(
          [
            snap.id,
            snap.createdAt.toISOString(),
            this.escapeCsv(asset.assetCode),
            this.escapeCsv(asset.assetIssuer ?? ''),
            asset.amount,
            asset.valueUsd,
            snap.totalValueUsd,
          ].join(','),
        );
      }
    }

    return rows.join('\n');
  }

  private async buildTaxTransactionsCsv(userId: string): Promise<string> {
    // Use userId as the public key lookup key (matches existing pattern)
    const { transactions } =
      await this.transactionService.getTransactionHistory(userId, 200);

    const rows = [
      'transaction_id,date,type,asset_code,asset_issuer,amount,from,to,status,fee,memo,description',
    ];

    for (const tx of transactions) {
      rows.push(
        [
          this.escapeCsv(tx.id),
          tx.date,
          tx.type,
          this.escapeCsv(tx.assetCode),
          this.escapeCsv(tx.assetIssuer ?? ''),
          tx.amount,
          this.escapeCsv(tx.from),
          this.escapeCsv(tx.to),
          tx.status,
          this.escapeCsv(tx.fee ?? ''),
          this.escapeCsv(tx.memo ?? ''),
          this.escapeCsv(tx.description),
        ].join(','),
      );
    }

    return rows.join('\n');
  }

  private escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
