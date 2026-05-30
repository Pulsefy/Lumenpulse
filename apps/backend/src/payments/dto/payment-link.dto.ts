import {
  IsString,
  IsNumber,
  IsOptional,
  IsDateString,
  IsEnum,
  Min,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentLinkStatus } from '../entities/payment-link.entity';

export class CreatePaymentLinkDto {
  @ApiProperty({ description: 'Unique link identifier within organization' })
  @IsString()
  linkId: string;

  @ApiProperty({ description: 'Title for the payment link' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ description: 'Description of the payment link' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Stellar token address for payments' })
  @IsString()
  tokenAddress: string;

  @ApiProperty({ description: 'Amount to be paid' })
  @IsString()
  amount: string;

  @ApiPropertyOptional({ description: 'Currency code (e.g., USD, EUR)' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'Recipient public key' })
  @IsOptional()
  @IsString()
  recipient?: string;

  @ApiPropertyOptional({ description: 'Expiration timestamp' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({ description: 'Additional metadata' })
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class PaymentLinkResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() organizationId: string;
  @ApiProperty() linkId: string;
  @ApiProperty() title: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty() tokenAddress: string;
  @ApiProperty() amount: string;
  @ApiPropertyOptional() currency?: string;
  @ApiPropertyOptional() recipient?: string;
  @ApiProperty() status: PaymentLinkStatus;
  @ApiPropertyOptional() expiresAt?: Date;
  @ApiPropertyOptional() completedAt?: Date;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class ListPaymentLinksQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(PaymentLinkStatus)
  status?: PaymentLinkStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  limit?: number = 50;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  offset?: number = 0;
}