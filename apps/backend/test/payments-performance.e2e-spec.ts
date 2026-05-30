import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PaymentsModule } from '../src/payments/payments.module';
import { PaymentsService } from '../src/payments/payments.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PaymentLink, PaymentLinkStatus } from '../src/payments/entities/payment-link.entity';
import { IdempotencyKey } from '../src/payments/entities/idempotency-key.entity';
import { PaymentTransaction, PaymentTransactionStatus } from '../src/payments/entities/payment-transaction.entity';
import { Repository } from 'typeorm';

describe('Payments Performance (e2e)', () => {
  let app: INestApplication;
  let paymentLinksRepo: Repository<PaymentLink>;
  let idempotencyKeysRepo: Repository<IdempotencyKey>;
  let paymentTransactionsRepo: Repository<PaymentTransaction>;

  const testOrgId = '550e8400-e29b-41d4-a716-446655440001';

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PaymentsModule],
    })
      .overrideProvider(getRepositoryToken(PaymentLink))
      .useValue({
        findOne: jest.fn(),
        findAndCount: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
      })
      .overrideProvider(getRepositoryToken(IdempotencyKey))
      .useValue({
        findOne: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
      })
      .overrideProvider(getRepositoryToken(PaymentTransaction))
      .useValue({
        findOne: jest.fn(),
        findAndCount: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    paymentLinksRepo = moduleFixture.get(getRepositoryToken(PaymentLink));
    idempotencyKeysRepo = moduleFixture.get(getRepositoryToken(IdempotencyKey));
    paymentTransactionsRepo = moduleFixture.get(getRepositoryToken(PaymentTransaction));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('Link list endpoint performance', () => {
    it('should maintain consistent latency under concurrent load', async () => {
      const mockLinks = Array.from({ length: 50 }, (_, i) => ({
        id: `link-${i}`,
        organizationId: testOrgId,
        linkId: `link-${i}`,
        title: `Test Link ${i}`,
        description: `Description ${i}`,
        tokenAddress: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        amount: '1000',
        status: PaymentLinkStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      (paymentLinksRepo.findAndCount as jest.Mock).mockResolvedValue([mockLinks, 50]);
      (paymentLinksRepo.create as jest.Mock).mockReturnValue({});
      (paymentLinksRepo.save as jest.Mock).mockResolvedValue({});

      const concurrentRequests = 20;
      const startTime = Date.now();

      const promises = Array.from({ length: concurrentRequests }, (_, i) =>
        request(app.getHttpServer())
          .get('/payments/links')
          .set('x-organization-id', testOrgId)
          .set('idempotency-key', `perf-test-${i}`)
          .expect(200),
      );

      const responses = await Promise.all(promises);
      const totalTime = Date.now() - startTime;
      const avgLatency = totalTime / concurrentRequests;

      responses.forEach((res) => {
        expect(res.body.links).toHaveLength(50);
      });

      expect(avgLatency).toBeLessThan(100);
      expect(totalTime).toBeLessThan(2000);
    });

    it('should efficiently filter by status with index support', async () => {
      const mockLinks = Array.from({ length: 25 }, (_, i) => ({
        id: `active-link-${i}`,
        organizationId: testOrgId,
        linkId: `active-link-${i}`,
        title: `Active Link ${i}`,
        tokenAddress: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        amount: '1000',
        status: PaymentLinkStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      (paymentLinksRepo.findAndCount as jest.Mock).mockResolvedValue([mockLinks, 25]);

      const response = await request(app.getHttpServer())
        .get('/payments/links')
        .query({ status: PaymentLinkStatus.ACTIVE, limit: 100 })
        .set('x-organization-id', testOrgId)
        .expect(200);

      expect(response.body.links).toHaveLength(25);
      expect(response.body.total).toBe(25);

      const callArgs = (paymentLinksRepo.findAndCount as jest.Mock).mock.calls[0][0];
      expect(callArgs.where).toHaveProperty('status', PaymentLinkStatus.ACTIVE);
    });
  });

  describe('Link detail endpoint performance', () => {
    it('should retrieve single link efficiently by composite key', async () => {
      const mockLink = {
        id: 'test-link-id',
        organizationId: testOrgId,
        linkId: 'perf-link',
        title: 'Performance Test Link',
        tokenAddress: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        amount: '5000',
        status: PaymentLinkStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (paymentLinksRepo.findOne as jest.Mock).mockResolvedValue(mockLink);

      const response = await request(app.getHttpServer())
        .get('/payments/links/perf-link')
        .set('x-organization-id', testOrgId)
        .expect(200);

      expect(response.body.linkId).toBe('perf-link');

      const callArgs = (paymentLinksRepo.findOne as jest.Mock).mock.calls[0][0];
      expect(callArgs.where).toHaveProperty('organizationId', testOrgId);
      expect(callArgs.where).toHaveProperty('linkId', 'perf-link');
    });
  });

  describe('Transaction history endpoint performance', () => {
    it('should retrieve transaction history efficiently', async () => {
      const mockTransactions = Array.from({ length: 30 }, (_, i) => ({
        id: `tx-${i}`,
        paymentLinkId: 'link-1',
        organizationId: testOrgId,
        transactionHash: `0x${Math.random().toString(16).slice(2, 66)}`,
        senderPublicKey: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        receiverPublicKey: 'GBYD6MQZFKGTX4XFNXMZPTBOHSXMCURJJR7JTXRLDTZBQ7IJQFZUWEJ',
        tokenAddress: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        amount: '1000',
        fee: '100',
        status: PaymentTransactionStatus.SUCCESS,
        createdAt: new Date(Date.now() - i * 60000),
      }));

      (paymentTransactionsRepo.findAndCount as jest.Mock).mockResolvedValue([mockTransactions, 30]);

      const response = await request(app.getHttpServer())
        .get('/payments/transactions')
        .query({ limit: 50, offset: 0 })
        .set('x-organization-id', testOrgId)
        .expect(200);

      expect(response.body.transactions).toHaveLength(30);
      expect(response.body.total).toBe(30);

      const callArgs = (paymentTransactionsRepo.findAndCount as jest.Mock).mock.calls[0][0];
      expect(callArgs.where).toHaveProperty('organizationId', testOrgId);
      expect(callArgs.order).toEqual({ createdAt: 'DESC' });
    });

    it('should filter transactions by status efficiently', async () => {
      const mockTransactions = [
        {
          id: 'tx-1',
          paymentLinkId: 'link-1',
          organizationId: testOrgId,
          transactionHash: '0xabc123',
          senderPublicKey: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          receiverPublicKey: 'GBYD6MQZFKGTX4XFNXMZPTBOHSXMCURJJR7JTXRLDTZBQ7IJQFZUWEJ',
          amount: '1000',
          fee: '100',
          status: PaymentTransactionStatus.SUCCESS,
          createdAt: new Date(),
        },
      ];

      (paymentTransactionsRepo.findAndCount as jest.Mock).mockResolvedValue([mockTransactions, 1]);

      await request(app.getHttpServer())
        .get('/payments/transactions')
        .query({ status: PaymentTransactionStatus.SUCCESS })
        .set('x-organization-id', testOrgId)
        .expect(200);

      const callArgs = (paymentTransactionsRepo.findAndCount as jest.Mock).mock.calls[0][0];
      expect(callArgs.where).toHaveProperty('status', PaymentTransactionStatus.SUCCESS);
    });
  });

  describe('Idempotency key performance', () => {
    it('should prevent duplicate writes within same organization', async () => {
      const existingKey = {
        id: 'key-1',
        key: 'idempotency-test-123',
        organizationId: testOrgId,
        paymentLinkId: 'link-1',
        transactionHash: '0xabc123',
        createdAt: new Date(),
      };

      const mockTx = {
        id: 'tx-1',
        paymentLinkId: 'link-1',
        organizationId: testOrgId,
        transactionHash: '0xabc123',
        senderPublicKey: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        receiverPublicKey: 'GBYD6MQZFKGTX4XFNXMZPTBOHSXMCURJJR7JTXRLDTZBQ7IJQFZUWEJ',
        amount: '1000',
        fee: '100',
        status: PaymentTransactionStatus.SUCCESS,
        createdAt: new Date(),
      };

      (idempotencyKeysRepo.findOne as jest.Mock).mockResolvedValue(existingKey);
      (paymentTransactionsRepo.findOne as jest.Mock).mockResolvedValue(mockTx);

      const response = await request(app.getHttpServer())
        .post('/payments/transactions')
        .set('x-organization-id', testOrgId)
        .set('idempotency-key', 'idempotency-test-123')
        .send({ paymentLinkId: 'link-1', senderPublicKey: 'GA5Z...', amount: '1000' })
        .expect(201);

      expect(response.body.transactionHash).toBe('0xabc123');
    });
  });
});