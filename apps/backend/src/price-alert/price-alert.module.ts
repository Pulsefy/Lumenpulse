import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PriceAlertRule } from './entities/price-alert-rule.entity';
import { PriceAlertEvaluationLog } from './entities/price-alert-evaluation-log.entity';
import { PriceAlertRuleService } from './price-alert-rule.service';
import { PriceAlertEvaluationService } from './price-alert-evaluation.service';
import { PriceAlertRuleController } from './price-alert-rule.controller';
import { PriceModule } from '../price/price.module';
import { NotificationModule } from '../notification/notification.module';
import { SchedulerModule } from '../scheduler/scheduler.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PriceAlertRule, PriceAlertEvaluationLog]),
    PriceModule,
    NotificationModule,
    SchedulerModule,
  ],
  controllers: [PriceAlertRuleController],
  providers: [PriceAlertRuleService, PriceAlertEvaluationService],
  exports: [PriceAlertRuleService, PriceAlertEvaluationService],
})
export class PriceAlertModule {}
