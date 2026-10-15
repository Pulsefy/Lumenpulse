import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsInt,
  Min,
  MaxLength,
  Min as MinValidator,
} from 'class-validator';
import { PriceAlertCondition } from '../entities/price-alert-rule.entity';

export class CreatePriceAlertRuleDto {
  @ApiProperty({
    description: 'Asset symbol to monitor (e.g. XLM, USDC)',
    example: 'XLM',
  })
  @IsString()
  @MaxLength(50)
  symbol: string;

  @ApiProperty({
    description: 'Target price that triggers the alert',
    example: 0.15,
  })
  @IsNumber()
  @MinValidator(0)
  targetPrice: number;

  @ApiProperty({
    description: 'Condition that triggers the alert',
    enum: PriceAlertCondition,
    example: PriceAlertCondition.ABOVE,
  })
  @IsEnum(PriceAlertCondition)
  condition: PriceAlertCondition;

  @ApiPropertyOptional({
    description: 'Minimum minutes between repeated firings (default 60)',
    example: 60,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  cooldownMinutes?: number;
}
