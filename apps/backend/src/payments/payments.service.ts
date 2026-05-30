import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentLink, PaymentLinkStatus } from './entities/payment-link.entity';
import { IdempotencyKey } from './entities/idempotency-key.entity';
import { PaymentTransaction, PaymentTransactionStatus } from './entities/payment-transaction.entity';
import { CreatePaymentLinkDto, PaymentLinkResponseDto, ListPaymentLinksQueryDto } from './dto/payment-link.dto';
import { CreatePaymentTransactionDto, PaymentTransactionResponseDto } from './dto/payment-transaction.dto';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(PaymentLink)
    private paymentLinksRepo: Repository<PaymentLink>,
    @InjectRepository(IdempotencyKey)
    private idempotencyKeysRepo: Repository<IdempotencyKey>,
    @InjectRepository(PaymentTransaction)
    private paymentTransactionsRepo: Repository<PaymentTransaction>,
  ) {}

  async createPaymentLink(
    organizationId: string,
    dto: CreatePaymentLinkDto,
  ): Promise<PaymentLinkResponseDto> {
    const existing = await this.paymentLinksRepo.findOne({
      where: { organizationId, linkId: dto.linkId } as any,
    });
    if (existing) {
      throw new ConflictException('Payment link with this ID already exists');
    }

    const link = this.paymentLinksRepo.create({
      organizationId,
      ...dto,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    });
    await this.paymentLinksRepo.save(link);
    this.logger.log(`Created payment link ${dto.linkId} for org ${organizationId}`);
    return this.toResponseDto(link);
  }

  async getPaymentLink(organizationId: string, linkId: string): Promise<PaymentLinkResponseDto> {
    const link = await this.paymentLinksRepo.findOne({
      where: { organizationId, linkId } as any,
    });
    if (!link) {
      throw new NotFoundException('Payment link not found');
    }
    return this.toResponseDto(link);
  }

  async listPaymentLinks(
    organizationId: string,
    query: ListPaymentLinksQueryDto,
  ): Promise<{ links: PaymentLinkResponseDto[]; total: number }> {
    const where: any = { organizationId };
    if (query.status) {
      where.status = query.status;
    }

    const [links, total] = await this.paymentLinksRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: query.offset,
      take: query.limit,
    });

    return { links: links.map((l) => this.toResponseDto(l)), total };
  }

  async createTransaction(
    organizationId: string,
    idempotencyKey: string,
    dto: CreatePaymentTransactionDto,
  ): Promise<PaymentTransactionResponseDto> {
    const existingKey = await this.idempotencyKeysRepo.findOne({
      where: { key: idempotencyKey } as any,
    });
    if (existingKey) {
      const existingTx = await this.paymentTransactionsRepo.findOne({
        where: { id: existingKey.id } as any,
      });
      if (existingTx) {
        this.logger.log(`Returning cached transaction for idempotency key ${idempotencyKey}`);
        return this.toTransactionResponseDto(existingTx);
      }
    }

    const paymentLink = await this.paymentLinksRepo.findOne({
      where: { id: dto.paymentLinkId, organizationId } as any,
    });
    if (!paymentLink) {
      throw new NotFoundException('Payment link not found');
    }

    if (paymentLink.status !== PaymentLinkStatus.ACTIVE) {
      throw new BadRequestException('Payment link is not active');
    }

    const txHash = this.generateTxHash();
    const transaction = this.paymentTransactionsRepo.create({
      paymentLinkId: dto.paymentLinkId,
      organizationId,
      transactionHash: txHash,
      senderPublicKey: dto.senderPublicKey,
      receiverPublicKey: paymentLink.recipient || '',
      tokenAddress: paymentLink.tokenAddress,
      amount: dto.amount,
      fee: '100',
      status: PaymentTransactionStatus.PENDING,
    });

    const savedTx = await this.paymentTransactionsRepo.save(transaction);

    const key = this.idempotencyKeysRepo.create({
      key: idempotencyKey,
      organizationId,
      paymentLinkId: dto.paymentLinkId,
      transactionHash: txHash,
    });
    await this.idempotencyKeysRepo.save(key);

    this.logger.log(`Created transaction ${txHash} for link ${dto.paymentLinkId}`);
    return this.toTransactionResponseDto(savedTx);
  }

  async listTransactions(
    organizationId: string,
    query: { paymentLinkId?: string; status?: PaymentTransactionStatus; senderPublicKey?: string; limit?: number; offset?: number },
  ): Promise<{ transactions: PaymentTransactionResponseDto[]; total: number }> {
    const where: any = { organizationId };
    if (query.paymentLinkId) where.paymentLinkId = query.paymentLinkId;
    if (query.status) where.status = query.status;
    if (query.senderPublicKey) where.senderPublicKey = query.senderPublicKey;

    const [transactions, total] = await this.paymentTransactionsRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: query.offset || 0,
      take: query.limit || 50,
    });

    return {
      transactions: transactions.map((t) => this.toTransactionResponseDto(t)),
      total,
    };
  }

  async getTransaction(organizationId: string, transactionHash: string): Promise<PaymentTransactionResponseDto> {
    const tx = await this.paymentTransactionsRepo.findOne({
      where: { organizationId, transactionHash } as any,
    });
    if (!tx) {
      throw new NotFoundException('Transaction not found');
    }
    return this.toTransactionResponseDto(tx);
  }

  private toResponseDto(link: PaymentLink): PaymentLinkResponseDto {
    return {
      id: link.id,
      organizationId: link.organizationId,
      linkId: link.linkId,
      title: link.title,
      description: link.description ?? undefined,
      tokenAddress: link.tokenAddress,
      amount: link.amount,
      currency: link.currency ?? undefined,
      recipient: link.recipient ?? undefined,
      status: link.status,
      expiresAt: link.expiresAt ?? undefined,
      completedAt: link.completedAt ?? undefined,
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
    };
  }

  private toTransactionResponseDto(tx: PaymentTransaction): PaymentTransactionResponseDto {
    return {
      id: tx.id,
      paymentLinkId: tx.paymentLinkId,
      transactionHash: tx.transactionHash,
      senderPublicKey: tx.senderPublicKey,
      receiverPublicKey: tx.receiverPublicKey,
      tokenAddress: tx.tokenAddress ?? undefined,
      amount: tx.amount,
      status: tx.status,
      errorMessage: tx.errorMessage ?? undefined,
      createdAt: tx.createdAt,
    };
  }

  private generateTxHash(): string {
    return `0x${Math.random().toString(16).slice(2, 66).padEnd(64, '0')}`;
  }
}