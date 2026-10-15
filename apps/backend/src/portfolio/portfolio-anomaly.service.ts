import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OptimisticLockVersionMismatchError, Repository } from 'typeorm';
import {
  PortfolioAnomaly,
  PortfolioAnomalySeverity,
  PortfolioAnomalyStatus,
} from './entities/portfolio-anomaly.entity';
import {
  CreatePortfolioAnomalyDto,
  ReviewPortfolioAnomalyDto,
} from './dto/portfolio-anomaly.dto';

@Injectable()
export class PortfolioAnomalyService {
  private readonly logger = new Logger(PortfolioAnomalyService.name);

  constructor(
    @InjectRepository(PortfolioAnomaly)
    private readonly anomalyRepository: Repository<PortfolioAnomaly>,
  ) {}

  async createAnomaly(
    dto: CreatePortfolioAnomalyDto,
  ): Promise<PortfolioAnomaly> {
    const anomaly = this.anomalyRepository.create({
      userId: dto.userId,
      title: dto.title,
      description: dto.description ?? null,
      anomalyType: dto.anomalyType,
      severity: dto.severity ?? PortfolioAnomalySeverity.MEDIUM,
      status: PortfolioAnomalyStatus.UNRESOLVED,
    });

    return this.anomalyRepository.save(anomaly);
  }

  async getAnomalies(userId?: string): Promise<PortfolioAnomaly[]> {
    const where = userId ? { userId } : undefined;
    return this.anomalyRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  async reviewAnomaly(
    id: string,
    reviewerId: string,
    dto: ReviewPortfolioAnomalyDto,
  ): Promise<PortfolioAnomaly> {
    const anomaly = await this.anomalyRepository.findOne({ where: { id } });
    if (!anomaly) {
      throw new NotFoundException(`Anomaly ${id} not found`);
    }

    anomaly.status = dto.status;
    anomaly.reviewerId = reviewerId;

    if (dto.reviewerNotes !== undefined) {
      anomaly.reviewerNotes = dto.reviewerNotes;
      anomaly.reviewerNotesUpdatedAt = new Date();
    }

    if (
      dto.status === PortfolioAnomalyStatus.ACKNOWLEDGED &&
      !anomaly.reviewedAt
    ) {
      anomaly.reviewedAt = new Date();
    }

    if (dto.status === PortfolioAnomalyStatus.UNRESOLVED) {
      anomaly.reviewedAt = null;
    }

    try {
      return await this.anomalyRepository.save(anomaly);
    } catch (error) {
      if (error instanceof OptimisticLockVersionMismatchError) {
        this.logger.warn(`Concurrent update detected for anomaly ${id}`);
        throw new ConflictException('Anomaly was updated by another reviewer');
      }
      throw error;
    }
  }
}
