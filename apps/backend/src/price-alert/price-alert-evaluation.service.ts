import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PriceAlertRule,
  PriceAlertCondition,
} from './entities/price-alert-rule.entity';
import { PriceAlertEvaluationLog } from './entities/price-alert-evaluation-log.entity';
import { PriceService } from '../price/price.service';
import { NotificationFanoutService } from '../notification/notification-fanout.service';
import { JobLockService } from '../scheduler/job-lock.service';
import { JobHistoryService } from '../scheduler/job-history.service';
import {
  NotificationType,
  NotificationSeverity,
} from '../notification/notification.entity';
import { EventCategory } from '../common/event-catalog';

const JOB_NAME = 'price-alert-evaluation';

@Injectable()
export class PriceAlertEvaluationService {
  private readonly logger = new Logger(PriceAlertEvaluationService.name);

  constructor(
    @InjectRepository(PriceAlertRule)
    private readonly ruleRepository: Repository<PriceAlertRule>,
    @InjectRepository(PriceAlertEvaluationLog)
    private readonly evaluationLogRepository: Repository<PriceAlertEvaluationLog>,
    private readonly priceService: PriceService,
    private readonly fanoutService: NotificationFanoutService,
    private readonly jobLockService: JobLockService,
    private readonly jobHistoryService: JobHistoryService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async evaluateAlertRules(): Promise<void> {
    const run = await this.jobHistoryService.start(JOB_NAME);

    try {
      const result = await this.jobLockService.withLock(JOB_NAME, () =>
        this.doEvaluate(),
      );

      if (result === null) {
        await this.jobHistoryService.markSkipped(JOB_NAME);
        return;
      }

      await this.jobHistoryService.complete(run, result);
    } catch (error) {
      await this.jobHistoryService.fail(run, error);
      this.logger.error(
        `Price alert evaluation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  private async doEvaluate(): Promise<Record<string, unknown>> {
    const activeRules = await this.ruleRepository.find({
      where: { isActive: true },
    });

    if (activeRules.length === 0) {
      return { evaluated: 0, triggered: 0, suppressed: 0 };
    }

    this.logger.log(
      `Evaluating ${activeRules.length} active price alert rules`,
    );

    const uniqueSymbols = [...new Set(activeRules.map((r) => r.symbol))];
    const priceCache = new Map<string, number>();

    for (const symbol of uniqueSymbols) {
      try {
        const price = await this.priceService.getCurrentPrice(symbol);
        priceCache.set(symbol, price);
      } catch (error) {
        this.logger.warn(
          `Failed to fetch price for ${symbol}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }

    let triggered = 0;
    let suppressed = 0;

    for (const rule of activeRules) {
      const currentPrice = priceCache.get(rule.symbol);

      if (currentPrice === undefined) {
        await this.logEvaluation(rule, 0, false, 'price_unavailable');
        suppressed++;
        continue;
      }

      const conditionMet = this.isConditionMet(
        rule.condition,
        currentPrice,
        rule.targetPrice,
      );

      if (!conditionMet) {
        await this.logEvaluation(rule, currentPrice, false, null);
        continue;
      }

      if (!this.isCooldownExpired(rule)) {
        await this.logEvaluation(rule, currentPrice, false, 'cooldown_active');
        suppressed++;
        continue;
      }

      try {
        const notificationResult = await this.fanoutService.fanout({
          notification: {
            type: NotificationType.PRICE,
            title: `Price Alert: ${rule.symbol}`,
            message: `${rule.symbol} has ${rule.condition === PriceAlertCondition.ABOVE ? 'risen above' : 'fallen below'} ${rule.targetPrice}. Current price: ${currentPrice}.`,
            severity: NotificationSeverity.MEDIUM,
            eventCategory: EventCategory.PRICE,
            metadata: {
              ruleId: rule.id,
              symbol: rule.symbol,
              targetPrice: rule.targetPrice,
              currentPrice,
              condition: rule.condition,
            },
          },
          targetUserIds: [rule.userId],
          symbols: [rule.symbol],
        });

        await this.ruleRepository.update(rule.id, {
          lastTriggeredAt: new Date(),
        });

        await this.logEvaluation(
          rule,
          currentPrice,
          true,
          null,
          notificationResult.notificationIds[0] ?? null,
        );

        triggered++;
      } catch (error) {
        this.logger.error(
          `Failed to dispatch notification for rule ${rule.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        await this.logEvaluation(
          rule,
          currentPrice,
          false,
          'notification_failed',
        );
        suppressed++;
      }
    }

    this.logger.log(
      `Price alert evaluation complete: ${triggered} triggered, ${suppressed} suppressed out of ${activeRules.length}`,
    );

    return {
      evaluated: activeRules.length,
      triggered,
      suppressed,
    };
  }

  private isConditionMet(
    condition: PriceAlertCondition,
    currentPrice: number,
    targetPrice: number,
  ): boolean {
    switch (condition) {
      case PriceAlertCondition.ABOVE:
        return currentPrice >= targetPrice;
      case PriceAlertCondition.BELOW:
        return currentPrice <= targetPrice;
      default:
        return false;
    }
  }

  private isCooldownExpired(rule: PriceAlertRule): boolean {
    if (!rule.lastTriggeredAt) return true;

    const now = new Date();
    const cooldownMs = rule.cooldownMinutes * 60 * 1000;
    const elapsed = now.getTime() - rule.lastTriggeredAt.getTime();

    return elapsed >= cooldownMs;
  }

  private async logEvaluation(
    rule: PriceAlertRule,
    currentPrice: number,
    triggered: boolean,
    suppressedReason: string | null,
    notificationId?: string | null,
  ): Promise<void> {
    try {
      const log = this.evaluationLogRepository.create({
        ruleId: rule.id,
        userId: rule.userId,
        symbol: rule.symbol,
        currentPrice,
        targetPrice: rule.targetPrice,
        condition: rule.condition,
        triggered,
        suppressedReason,
        notificationId: notificationId ?? null,
      });
      await this.evaluationLogRepository.save(log);
    } catch (error) {
      this.logger.error(
        `Failed to log evaluation for rule ${rule.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
