import { Controller, Get, Post, Query, Param, Body, Headers } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import {
  CreatePaymentLinkDto,
  ListPaymentLinksQueryDto,
  PaymentLinkResponseDto,
} from './dto/payment-link.dto';
import {
  CreatePaymentTransactionDto,
  PaymentTransactionResponseDto,
  ListTransactionsQueryDto,
} from './dto/payment-transaction.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('links')
  @ApiOperation({ summary: 'Create a payment link' })
  @ApiResponse({ type: PaymentLinkResponseDto })
  createPaymentLink(
    @Body() dto: CreatePaymentLinkDto,
    @Headers('x-organization-id') organizationId: string,
  ): Promise<any> {
    return this.paymentsService.createPaymentLink(organizationId, dto);
  }

  @Get('links')
  @ApiOperation({ summary: 'List payment links' })
  listPaymentLinks(
    @Query() query: ListPaymentLinksQueryDto,
    @Headers('x-organization-id') organizationId: string,
  ): Promise<any> {
    return this.paymentsService.listPaymentLinks(organizationId, query);
  }

  @Get('links/:linkId')
  @ApiOperation({ summary: 'Get a payment link by ID' })
  getPaymentLink(
    @Param('linkId') linkId: string,
    @Headers('x-organization-id') organizationId: string,
  ): Promise<any> {
    return this.paymentsService.getPaymentLink(organizationId, linkId);
  }

  @Post('transactions')
  @ApiOperation({ summary: 'Create a payment transaction' })
  createTransaction(
    @Body() dto: CreatePaymentTransactionDto,
    @Headers('x-organization-id') organizationId: string,
    @Headers('idempotency-key') idempotencyKey: string,
  ): Promise<any> {
    return this.paymentsService.createTransaction(organizationId, idempotencyKey, dto);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'List payment transactions' })
  listTransactions(
    @Query() query: ListTransactionsQueryDto,
    @Headers('x-organization-id') organizationId: string,
  ): Promise<any> {
    return this.paymentsService.listTransactions(organizationId, query);
  }

  @Get('transactions/:hash')
  @ApiOperation({ summary: 'Get a transaction by hash' })
  getTransaction(
    @Param('hash') hash: string,
    @Headers('x-organization-id') organizationId: string,
  ): Promise<any> {
    return this.paymentsService.getTransaction(organizationId, hash);
  }
}