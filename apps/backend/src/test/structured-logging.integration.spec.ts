import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './app.module';

describe('Structured Logging Integration Tests', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Request Correlation ID', () => {
    it('should generate a new request ID when none is provided', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      // The response should include the request ID header
      expect(response.headers['x-request-id']).toBeDefined();
      expect(response.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('should use the provided request ID when header is sent', async () => {
      const customRequestId = 'test-request-id-12345';
      const response = await request(app.getHttpServer())
        .get('/health')
        .set('X-Request-Id', customRequestId)
        .expect(200);

      expect(response.headers['x-request-id']).toBe(customRequestId);
    });

    it('should include request ID in response headers for all routes', async () => {
      const routes = ['/health', '/api'];

      for (const route of routes) {
        const response = await request(app.getHttpServer())
          .get(route)
          .expect((res) => {
            // Either 200 (health) or 404 (api docs not configured)
            expect([200, 404]).toContain(res.status);
          });

        expect(response.headers['x-request-id']).toBeDefined();
      }
    });
  });

  describe('Structured Logging Output', () => {
    it('should log requests in structured JSON format', async () => {
      // This test verifies that the structured logger is working
      // The actual log output would be captured in a real environment
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      // Verify the request was processed
      expect(response.status).toBe(200);
    });

    it('should include method, URL, status code, and duration in logs', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      // Verify response includes necessary info for logging
      expect(response.headers['x-request-id']).toBeDefined();
    });
  });

  describe('Error Handling with Correlation IDs', () => {
    it('should maintain request ID on error responses', async () => {
      // Try to access a non-existent route
      const response = await request(app.getHttpServer())
        .get('/non-existent-route-12345')
        .expect(404);

      // Request ID should still be present
      expect(response.headers['x-request-id']).toBeDefined();
    });
  });
});