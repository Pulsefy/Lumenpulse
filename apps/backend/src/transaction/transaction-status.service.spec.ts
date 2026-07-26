import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { getRepositoryToken } from '@nestjs/typeorm';
import { of } from 'rxjs';
import { TransactionStatusService } from './transaction-status.service';
import {
  TransactionCallback,
  TransactionCallbackStatus,
} from './entities/transaction-callback.entity';
import { SorobanRpcClientService } from '../stellar/services/soroban-rpc-client.service';
import { WebhookService } from '../webhook/webhook.service';

describe('TransactionStatusService', () => {
  let service: TransactionStatusService;
  let callbackRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
  };
  let httpService: { post: jest.Mock };
  let webhookService: { buildSignatureHeaders: jest.Mock };

  beforeEach(async () => {
    callbackRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
    };

    httpService = {
      post: jest.fn(),
    };

    webhookService = {
      buildSignatureHeaders: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionStatusService,
        {
          provide: getRepositoryToken(TransactionCallback),
          useValue: callbackRepository,
        },
        {
          provide: SorobanRpcClientService,
          useValue: {
            getTransaction: jest.fn(),
          },
        },
        {
          provide: HttpService,
          useValue: httpService,
        },
        {
          provide: WebhookService,
          useValue: webhookService,
        },
      ],
    }).compile();

    service = module.get(TransactionStatusService);
  });

  it('records delivery history and signature metadata for secret-rotated callbacks', async () => {
    const callback = {
      id: 'callback-1',
      transactionHash: 'abc123',
      callbackUrl: 'https://example.com/webhook',
      status: TransactionCallbackStatus.PENDING,
      retryCount: 0,
      secret: 'current-secret',
      previousSecret: 'previous-secret',
      secretId: 'active',
      deliveryHistory: [],
      lastDeliveryStatus: null,
      lastSignature: null,
      lastResponseStatusCode: null,
      lastDeliveredAt: null,
      lastDeliveryError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as TransactionCallback & {
      deliveryHistory: Array<Record<string, unknown>>;
    };

    callbackRepository.findOne.mockResolvedValue(callback);
    callbackRepository.create.mockReturnValue(callback);
    callbackRepository.save.mockResolvedValue(callback);
    webhookService.buildSignatureHeaders.mockReturnValue({
      'X-Webhook-Signature': 'sha256=current-signature',
      'X-Webhook-Previous-Signature': 'sha256=previous-signature',
      'X-Webhook-Secret-Id': 'active',
    });
    httpService.post.mockReturnValue(of({ status: 200, data: { ok: true } }));

    const savedCallback = await service.registerCallback({
      transactionHash: 'abc123',
      callbackUrl: 'https://example.com/webhook',
      secret: 'current-secret',
    });

    await service['notifyCallback'](savedCallback, 'SUCCESS');

    expect(savedCallback.lastDeliveryStatus).toBe('delivered');
    expect(savedCallback.lastSignature).toBe('sha256=current-signature');
    expect(savedCallback.lastResponseStatusCode).toBe(200);
    expect(savedCallback.deliveryHistory).toHaveLength(1);
    expect(savedCallback.deliveryHistory[0]).toEqual(
      expect.objectContaining({
        status: 'delivered',
        secretId: 'active',
        signature: 'sha256=current-signature',
      }),
    );
  });
});
