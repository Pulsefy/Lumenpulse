import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentTransactionStatus } from '../entities/payment-transaction.entity';

export class CreatePaymentTransactionDto {
  @ApiProperty({ description: 'Payment link ID' })
  @IsString()
  paymentLinkId: string;

  @ApiProperty({ description: 'Sender Stellar public key' })
  @IsString()
  senderPublicKey: string;

  @ApiProperty({ description: 'Amount to transfer' })
  @IsString()
  amount: string;
}

export class PaymentTransactionResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() paymentLinkId: string;
  @ApiProperty() transactionHash: string;
  @ApiProperty() senderPublicKey: string;
  @ApiProperty() receiverPublicKey: string;
  @ApiPropertyOptional() tokenAddress?: string;
  @ApiProperty() amount: string;
  @ApiProperty() status: PaymentTransactionStatus;
  @ApiPropertyOptional() errorMessage?: string;
  @ApiProperty() createdAt: Date;
}

export class ListTransactionsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentLinkId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  senderPublicKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(PaymentTransactionStatus)
  status?: PaymentTransactionStatus;

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