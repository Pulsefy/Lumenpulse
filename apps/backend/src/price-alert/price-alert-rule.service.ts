import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PriceAlertRule } from './entities/price-alert-rule.entity';
import { CreatePriceAlertRuleDto } from './dto/create-price-alert-rule.dto';
import { UpdatePriceAlertRuleDto } from './dto/update-price-alert-rule.dto';

@Injectable()
export class PriceAlertRuleService {
  private readonly logger = new Logger(PriceAlertRuleService.name);

  constructor(
    @InjectRepository(PriceAlertRule)
    private readonly ruleRepository: Repository<PriceAlertRule>,
  ) {}

  async create(
    userId: string,
    dto: CreatePriceAlertRuleDto,
  ): Promise<PriceAlertRule> {
    this.logger.log(
      `Creating price alert for ${dto.symbol} ${dto.condition} ${dto.targetPrice} for user ${userId}`,
    );

    const rule = this.ruleRepository.create({
      userId,
      symbol: dto.symbol.toUpperCase(),
      targetPrice: dto.targetPrice,
      condition: dto.condition,
      cooldownMinutes: dto.cooldownMinutes ?? 60,
      isActive: true,
    });

    return this.ruleRepository.save(rule);
  }

  async findAllForUser(userId: string): Promise<PriceAlertRule[]> {
    return this.ruleRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOneForUser(
    userId: string,
    ruleId: string,
  ): Promise<PriceAlertRule> {
    const rule = await this.ruleRepository.findOne({
      where: { id: ruleId, userId },
    });

    if (!rule) {
      throw new NotFoundException(`Price alert rule ${ruleId} not found`);
    }

    return rule;
  }

  async update(
    userId: string,
    ruleId: string,
    dto: UpdatePriceAlertRuleDto,
  ): Promise<PriceAlertRule> {
    const rule = await this.findOneForUser(userId, ruleId);

    if (dto.targetPrice !== undefined) rule.targetPrice = dto.targetPrice;
    if (dto.condition !== undefined) rule.condition = dto.condition;
    if (dto.isActive !== undefined) rule.isActive = dto.isActive;
    if (dto.cooldownMinutes !== undefined) {
      rule.cooldownMinutes = dto.cooldownMinutes;
    }

    this.logger.log(`Updating price alert rule ${ruleId} for user ${userId}`);

    return this.ruleRepository.save(rule);
  }

  async remove(userId: string, ruleId: string): Promise<void> {
    const rule = await this.findOneForUser(userId, ruleId);

    this.logger.log(`Removing price alert rule ${ruleId} for user ${userId}`);

    await this.ruleRepository.remove(rule);
  }

  async findAllActive(): Promise<PriceAlertRule[]> {
    return this.ruleRepository.find({
      where: { isActive: true },
    });
  }

  async updateLastTriggered(ruleId: string): Promise<void> {
    await this.ruleRepository.update(ruleId, {
      lastTriggeredAt: new Date(),
    });
  }
}
