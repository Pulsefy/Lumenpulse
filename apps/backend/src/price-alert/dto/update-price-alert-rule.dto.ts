import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsInt,
  IsBoolean,
  Min,
  Min as MinValidator,
} from 'class-validator';
import { PriceAlertCondition } from '../entities/price-alert-rule.entity';

export class UpdatePriceAlertRuleDto {
  @ApiPropertyOptional({
    description: 'Updated target price',
    example: 0.2,
  })
  @IsOptional()
  @IsNumber()
  @MinValidator(0)
  targetPrice?: number;

  @ApiPropertyOptional({
    description: 'Updated trigger condition',
    enum: PriceAlertCondition,
  })
  @IsOptional()
  @IsEnum(PriceAlertCondition)
  condition?: PriceAlertCondition;

  @ApiPropertyOptional({
    description: 'Enable or disable the alert rule',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Updated cooldown in minutes between firings',
    example: 120,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  cooldownMinutes?: number;
}
