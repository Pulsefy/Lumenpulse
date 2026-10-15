import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CustomValidationPipe } from '../src/common/pipes/validation.pipe';
import { type App } from 'supertest/types';

// Define expected response types for validation errors
interface ValidationErrorDetail {
  field: string;
  message: string;
}

interface ValidationErrorResponse {
  code: string;
  message: string;
  details: ValidationErrorDetail[];
}

// Type-safe request wrapper to avoid ESLint warnings
const makeRequest = (app: INestApplication) => {
  const httpServer = app.getHttpServer() as unknown;
  // Cast to any to bypass the type issue with supertest
  return request(httpServer as App);
};

describe('Contract Invocation Validation (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Use the CustomValidationPipe globally
    app.useGlobalPipes(new CustomValidationPipe());
    await app.init();

    // Setup admin token (mock authentication)
    adminToken = 'mock-admin-token';
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Treasury Validation', () => {
    it('should reject invalid beneficiary address', async () => {
      const response = await makeRequest(app)
        .post('/treasury/streams')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          beneficiary: 'INVALID_ADDRESS',
          amount: '1000000000',
          startTime: Math.floor(Date.now() / 1000) + 3600,
          duration: 2592000,
        });

      const body = response.body as ValidationErrorResponse;

      expect(response.status).toBe(400);
      expect(body.code).toBe('SYS_VALIDATION_FAILED');
      expect(body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'beneficiary',
            message: expect.stringContaining('valid Stellar address') as string,
          }),
        ]),
      );
    });

    it('should reject invalid amount (non-positive)', async () => {
      const response = await makeRequest(app)
        .post('/treasury/streams')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          beneficiary: 'GABCDEF1234567890',
          amount: '0',
          startTime: Math.floor(Date.now() / 1000) + 3600,
          duration: 2592000,
        });

      const body = response.body as ValidationErrorResponse;

      expect(response.status).toBe(400);
      expect(body.code).toBe('SYS_VALIDATION_FAILED');
      expect(body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'amount',
            message: expect.stringContaining('positive integer') as string,
          }),
        ]),
      );
    });

    it('should reject invalid startTime (negative)', async () => {
      const response = await makeRequest(app)
        .post('/treasury/streams')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          beneficiary: 'GABCDEF1234567890',
          amount: '1000000000',
          startTime: -100,
          duration: 2592000,
        });

      const body = response.body as ValidationErrorResponse;

      expect(response.status).toBe(400);
      expect(body.code).toBe('SYS_VALIDATION_FAILED');
      expect(body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'startTime',
            message: expect.stringContaining('at least 0') as string,
          }),
        ]),
      );
    });

    it('should reject invalid duration (zero or negative)', async () => {
      const response = await makeRequest(app)
        .post('/treasury/streams')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          beneficiary: 'GABCDEF1234567890',
          amount: '1000000000',
          startTime: Math.floor(Date.now() / 1000) + 3600,
          duration: 0,
        });

      const body = response.body as ValidationErrorResponse;

      expect(response.status).toBe(400);
      expect(body.code).toBe('SYS_VALIDATION_FAILED');
      expect(body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'duration',
            message: expect.stringContaining('at least 1') as string,
          }),
        ]),
      );
    });

    it('should reject extra properties (forbidNonWhitelisted)', async () => {
      const response = await makeRequest(app)
        .post('/treasury/streams')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          beneficiary: 'GABCDEF1234567890',
          amount: '1000000000',
          startTime: Math.floor(Date.now() / 1000) + 3600,
          duration: 2592000,
          extraField: 'should not be allowed',
        });

      const body = response.body as ValidationErrorResponse;

      expect(response.status).toBe(400);
      expect(body.code).toBe('SYS_VALIDATION_FAILED');
      expect(body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'extraField',
            message: expect.stringContaining(
              'property should not exist',
            ) as string,
          }),
        ]),
      );
    });

    it('should accept valid payload', async () => {
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
    });
  });

  describe('Contributor Registry Validation', () => {
    it('should reject invalid address', async () => {
      const response = await makeRequest(app)
        .post('/contributor-registry/register')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          address: 'INVALID_ADDRESS',
          githubHandle: 'testuser',
        });

      const body = response.body as ValidationErrorResponse;

      expect(response.status).toBe(400);
      expect(body.code).toBe('SYS_VALIDATION_FAILED');
      expect(body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'address',
            message: expect.stringContaining('valid Stellar address') as string,
          }),
        ]),
      );
    });

    it('should reject invalid github handle (special characters)', async () => {
      const response = await makeRequest(app)
        .post('/contributor-registry/register')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          address: 'GABCDEF1234567890',
          githubHandle: 'test@user!',
        });

      const body = response.body as ValidationErrorResponse;

      expect(response.status).toBe(400);
      expect(body.code).toBe('SYS_VALIDATION_FAILED');
      expect(body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'githubHandle',
            message: expect.stringContaining('valid GitHub username') as string,
          }),
        ]),
      );
    });

    it('should reject invalid XDR for register-with-sig', async () => {
      const response = await makeRequest(app)
        .post('/contributor-registry/register-with-sig')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          address: 'GABCDEF1234567890',
          githubHandle: 'testuser',
          signedAuthEntryXdr: 'invalid-xdr',
        });

      const body = response.body as ValidationErrorResponse;

      expect(response.status).toBe(400);
      expect(body.code).toBe('SYS_VALIDATION_FAILED');
      expect(body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'signedAuthEntryXdr',
            message: expect.stringContaining(
              'valid base64-encoded XDR',
            ) as string,
          }),
        ]),
      );
    });

    it('should accept valid payload', async () => {
      const response = await makeRequest(app)
        .post('/contributor-registry/register')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          address: 'GABCDEF1234567890',
          githubHandle: 'testuser',
        });

      expect(response.status).toBe(201);
    });
  });

  describe('Matching Pool Validation', () => {
    it('should reject invalid matchingFunds (negative)', async () => {
      const response = await makeRequest(app)
        .post('/admin/matching-pool/rounds')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Test Round',
          matchingFunds: -100,
        });

      const body = response.body as ValidationErrorResponse;

      expect(response.status).toBe(400);
      expect(body.code).toBe('SYS_VALIDATION_FAILED');
      expect(body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'matchingFunds',
            message: expect.stringContaining('at least 1') as string,
          }),
        ]),
      );
    });

    it('should reject invalid projectAddress', async () => {
      const response = await makeRequest(app)
        .post('/admin/matching-pool/rounds/123/approve-project')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          projectAddress: 'INVALID_ADDRESS',
        });

      const body = response.body as ValidationErrorResponse;

      expect(response.status).toBe(400);
      expect(body.code).toBe('SYS_VALIDATION_FAILED');
      expect(body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'projectAddress',
            message: expect.stringContaining('valid Stellar address') as string,
          }),
        ]),
      );
    });

    it('should accept valid payload', async () => {
      const response = await makeRequest(app)
        .post('/admin/matching-pool/rounds')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Test Round',
          matchingFunds: 1000000,
          description: 'Test Description',
        });

      expect(response.status).toBe(201);
    });
  });

  describe('Standardized Error Responses', () => {
    it('should return standardized error format', async () => {
      const response = await makeRequest(app)
        .post('/treasury/streams')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          beneficiary: 'INVALID',
          amount: 'not-a-number',
          startTime: 'not-a-number',
          duration: 'not-a-number',
        });

      const body = response.body as ValidationErrorResponse;

      expect(response.status).toBe(400);
      expect(body).toMatchObject({
        code: 'SYS_VALIDATION_FAILED',
        message: 'Validation failed',
        details: expect.arrayContaining([
          expect.objectContaining({
            field: expect.any(String) as string,
            message: expect.any(String) as string,
          }),
        ]) as string,
      });
    });
  });
});
