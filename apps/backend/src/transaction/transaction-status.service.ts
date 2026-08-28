import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  TransactionCallback,
  TransactionCallbackStatus,
} from './entities/transaction-callback.entity';
import {
  RegisterTransactionCallbackDto,
  TransactionStatusUpdateDto,
} from './dto/transaction-callback.dto';
import { SorobanRpcClientService } from '../stellar/services/soroban-rpc-client.service';
import { WebhookService } from '../webhook/webhook.service';

@Injectable()
export class TransactionStatusService {
  private readonly logger = new Logger(TransactionStatusService.name);

  constructor(
    @InjectRepository(TransactionCallback)
    private readonly callbackRepository: Repository<TransactionCallback>,
    private readonly sorobanRpcService: SorobanRpcClientService,
    private readonly httpService: HttpService,
    private readonly webhookService: WebhookService,
  ) {}

  async registerCallback(
    dto: RegisterTransactionCallbackDto,
  ): Promise<TransactionCallback> {
    const existing = await this.callbackRepository.findOne({
      where: { transactionHash: dto.transactionHash },
    });

    if (existing) {
      return existing;
    }

    const callback = this.callbackRepository.create({
      transactionHash: dto.transactionHash,
      callbackUrl: dto.callbackUrl,
      status: TransactionCallbackStatus.PENDING,
      secretId: dto.secretId ?? null,
      previousSecretId: dto.previousSecretId ?? null,
      lastDeliveryStatus: null,
      lastSignature: null,
      lastResponseStatusCode: null,
      lastDeliveredAt: null,
      lastDeliveryError: null,
      deliveryHistory: [],
    });

    return this.callbackRepository.save(callback);
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async processCallbacks() {
    this.logger.log('Processing transaction callbacks...');

    // 1. Poll PENDING transactions to see if they are finalized
    await this.pollPendingTransactions();

    // 2. Retry notifications for FINALIZED or FAILED_TO_NOTIFY
    await this.retryNotifications();
  }

  private async pollPendingTransactions() {
    const pendingCallbacks = await this.callbackRepository.find({
      where: { status: TransactionCallbackStatus.PENDING },
    });

    if (pendingCallbacks.length === 0) return;

    for (const callback of pendingCallbacks) {
      try {
        const txResponse = await this.sorobanRpcService.getTransaction(
          callback.transactionHash,
        );
        const currentStatus = String(txResponse.status);

        if (currentStatus === 'SUCCESS' || currentStatus === 'FAILED') {
          this.logger.log(
            `Transaction ${callback.transactionHash} finalized with status ${txResponse.status}`,
          );

          callback.status = TransactionCallbackStatus.FINALIZED;
          if (currentStatus === 'FAILED') {
            const errorResult = (txResponse as { errorResult?: unknown })
              .errorResult;
            callback.lastError = JSON.stringify(errorResult ?? 'Unknown error');
          }

          await this.callbackRepository.save(callback);
          await this.notifyCallback(callback, currentStatus);
        }
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(
          `Failed to check status for transaction ${callback.transactionHash}: ${errorMsg}`,
        );
      }
    }
  }

  private async retryNotifications() {
    const needingNotification = await this.callbackRepository.find({
      where: {
        status: In([
          TransactionCallbackStatus.FINALIZED,
          TransactionCallbackStatus.FAILED_TO_NOTIFY,
        ]),
      },
    });

    for (const callback of needingNotification) {
      try {
        const txResponse = await this.sorobanRpcService.getTransaction(
          callback.transactionHash,
        );
        await this.notifyCallback(callback, String(txResponse.status));
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(
          `Failed to retry notification for ${callback.transactionHash}: ${errorMsg}`,
        );
      }
    }
  }

  private async notifyCallback(
    callback: TransactionCallback,
    txStatus: string,
  ) {
    const payload: TransactionStatusUpdateDto = {
      transactionHash: callback.transactionHash,
      status: txStatus === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
      timestamp: new Date().toISOString(),
      error: callback.lastError,
    };

    const signatureHeaders = this.webhookService.buildSignatureHeaders(
      payload,
      {
        secretId: callback.secretId ?? undefined,
        previousSecretId: callback.previousSecretId ?? undefined,
      },
    );
    const headers: Record<string, string | undefined> = {
      ...signatureHeaders,
      ...(callback.secretId
        ? { 'X-Webhook-Secret-Id': callback.secretId }
        : {}),
      ...(callback.previousSecretId
        ? { 'X-Webhook-Previous-Secret-Id': callback.previousSecretId }
        : {}),
    };
    const signatureHeader = headers['X-Webhook-Signature'];

    try {
      const response = await firstValueFrom(
        this.httpService.post(callback.callbackUrl, payload, {
          timeout: 5000,
          headers,
        }),
      );

      callback.status = TransactionCallbackStatus.NOTIFIED;
      callback.retryCount = 0;
      callback.lastDeliveryStatus = 'delivered';
      callback.lastSignature = signatureHeader ?? null;
      callback.lastResponseStatusCode = response?.status ?? 200;
      callback.lastDeliveredAt = new Date();
      callback.lastDeliveryError = null;
      const deliveryHistory: Array<Record<string, unknown>> = [
        ...(callback.deliveryHistory ?? []),
        {
          at: new Date().toISOString(),
          status: 'delivered',
          signature: signatureHeader ?? null,
          secretId: headers['X-Webhook-Secret-Id'] ?? null,
          previousSecretId: headers['X-Webhook-Previous-Secret-Id'] ?? null,
          responseStatusCode: response?.status ?? 200,
        },
      ];
      callback.deliveryHistory = deliveryHistory;
      await this.callbackRepository.save(callback);
      this.logger.log(
        `Successfully notified callback for ${callback.transactionHash}`,
      );
    } catch (error: unknown) {
      const errorMsg = this.getErrorMessage(error);
      this.logger.error(
        `Failed to notify callback for ${callback.transactionHash}: ${errorMsg}`,
      );
      callback.retryCount += 1;
      callback.status = TransactionCallbackStatus.FAILED_TO_NOTIFY;
      callback.lastError = `Notification failed: ${errorMsg}`;
      callback.lastDeliveryStatus = 'failed';
      callback.lastSignature = signatureHeader ?? null;
      callback.lastDeliveryError = errorMsg;
      const deliveryHistory: Array<Record<string, unknown>> = [
        ...(callback.deliveryHistory ?? []),
        {
          at: new Date().toISOString(),
          status: 'failed',
          signature: signatureHeader ?? null,
          secretId: headers['X-Webhook-Secret-Id'] ?? null,
          previousSecretId: headers['X-Webhook-Previous-Secret-Id'] ?? null,
          error: errorMsg,
        },
      ];
      callback.deliveryHistory = deliveryHistory;
      await this.callbackRepository.save(callback);
    }
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return 'Unknown error';
  }
}
