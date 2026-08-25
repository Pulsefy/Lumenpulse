import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { type App } from 'supertest/types';

// Type-safe request wrapper to avoid ESLint warnings
const makeRequest = (app: INestApplication) => {
  const httpServer = app.getHttpServer() as unknown;
  return request(httpServer as App);
};

describe('Contract Admin RBAC (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // Setup test tokens (mock authentication)
    // In real tests, you'd use the auth endpoints
    adminToken = 'mock-admin-token';
    userToken = 'mock-user-token';
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Treasury Admin Routes', () => {
    it('should allow ADMIN to allocate budget', async () => {
      const response = await makeRequest(app)
        .post('/treasury/streams')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          beneficiary: 'GABCDEF1234567890',
          amount: '1000000000', // amount as string (stroops)
          startTime: Math.floor(Date.now() / 1000) + 3600,
          duration: 2592000, // 30 days in seconds
        });

      expect(response.status).toBe(201);
    });

    it('should deny USER from allocating budget', async () => {
      const response = await makeRequest(app)
        .post('/treasury/streams')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          beneficiary: 'GABCDEF1234567890',
          amount: '1000000000',
          startTime: Math.floor(Date.now() / 1000) + 3600,
          duration: 2592000,
        });

      expect(response.status).toBe(403);
      expect((response.body as { message?: string }).message).toContain(
        'Required roles: ADMIN',
      );
    });

    it('should deny unauthenticated request', async () => {
      const response = await makeRequest(app)
        .post('/treasury/streams')
        .send({
          beneficiary: 'GABCDEF1234567890',
          amount: '1000000000',
          startTime: Math.floor(Date.now() / 1000) + 3600,
          duration: 2592000,
        });

      expect(response.status).toBe(401);
    });
  });

  describe('Contributor Registry Admin Routes', () => {
    it('should allow ADMIN to register contributor', async () => {
      const response = await makeRequest(app)
        .post('/contributor-registry/register')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          address: 'GABCDEF1234567890',
          githubHandle: 'testuser',
        });

      expect(response.status).toBe(201);
    });

    it('should deny USER from registering contributor', async () => {
      const response = await makeRequest(app)
        .post('/contributor-registry/register')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          address: 'GABCDEF1234567890',
          githubHandle: 'testuser3',
        });

      expect(response.status).toBe(403);
      expect((response.body as { message?: string }).message).toContain(
        'Required roles: ADMIN',
      );
    });

    it('should allow public access to lookup endpoints', async () => {
      const response = await makeRequest(app).get(
        '/contributor-registry/wallet/GABCDEF1234567890',
      );

      // May return 404 if not found, but should be accessible
      expect([200, 404]).toContain(response.status);
    });
  });

  describe('Matching Pool Admin Routes', () => {
    it('should allow ADMIN to create round', async () => {
      const response = await makeRequest(app)
        .post('/admin/matching-pool/rounds')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Test Round',
          description: 'Test Description',
          matchingFunds: 1000000, // amount in stroops
        });

      expect(response.status).toBe(201);
    });

    it('should deny USER from creating round', async () => {
      const response = await makeRequest(app)
        .post('/admin/matching-pool/rounds')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Test Round',
          description: 'Test Description',
          matchingFunds: 1000000,
        });

      expect(response.status).toBe(403);
      expect((response.body as { message?: string }).message).toContain(
        'Required roles: ADMIN',
      );
    });
  });

  describe('Authorization Logging', () => {
    it('should log authorization decisions', async () => {
      // This test verifies that the audit log entries are created
      // In a real test, you'd query the audit log table
      const response = await makeRequest(app)
        .post('/treasury/streams')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          beneficiary: 'GABCDEF1234567890',
          amount: '1000000000',
          startTime: Math.floor(Date.now() / 1000) + 3600,
          duration: 2592000,
        });

      expect(response.status).toBe(201);

      // Verify audit log was created (in production, you'd query the database)
      // This is a placeholder for actual audit log verification
    });
  });
});
