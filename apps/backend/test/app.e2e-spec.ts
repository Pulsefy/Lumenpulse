import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { GlobalExceptionFilter } from '../src/filters/global-exception.filter';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Apply the global exception filter for testing
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/nonexistent (GET) - should return standardized error response', () => {
    return request(app.getHttpServer())
      .get('/nonexistent')
      .expect(404)
      .then(
        (response: {
          body: {
            statusCode: unknown;
            message: unknown;
            error: unknown;
            timestamp: unknown;
            path: unknown;
          };
        }) => {
          expect(response.body).toHaveProperty('statusCode');
          expect(response.body).toHaveProperty('message');
          expect(response.body).toHaveProperty('error');
          expect(response.body).toHaveProperty('timestamp');
          expect(response.body).toHaveProperty('path');
          expect(response.body.statusCode).toBe(404);
          expect(typeof response.body.message).toBe('string');
          expect(typeof response.body.error).toBe('string');
          expect(typeof response.body.timestamp).toBe('string');
          expect(response.body.path).toBe('/nonexistent');
        },
      );
  });
});
