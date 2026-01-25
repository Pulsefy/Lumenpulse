import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { GlobalExceptionFilter } from '../src/filters/global-exception.filter';
import type { Server } from 'http';

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
    return request(app.getHttpServer() as unknown as Server)
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/nonexistent (GET) - should return standardized error response', () => {
    interface ErrorResponse {
      statusCode: number;
      message: string;
      error: string;
      timestamp: string;
      path: string;
    }

    return request(app.getHttpServer() as unknown as Server)
      .get('/nonexistent')
      .expect(404)
      .then((response) => {
        const body = response.body as ErrorResponse;

        expect(body).toHaveProperty('statusCode');
        expect(body).toHaveProperty('message');
        expect(body).toHaveProperty('error');
        expect(body).toHaveProperty('timestamp');
        expect(body).toHaveProperty('path');
        expect(body.statusCode).toBe(404);
        expect(typeof body.message).toBe('string');
        expect(typeof body.error).toBe('string');
        expect(typeof body.timestamp).toBe('string');
        expect(body.path).toBe('/nonexistent');
      });
  });
});
