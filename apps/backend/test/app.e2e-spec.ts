import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/filters/global-exception.filter';
import { ErrorCode } from '../src/common/enums/error-code.enum';
import { ErrorResponse } from '../src/interfaces/error-response.interface';

const makeRequest = (app: INestApplication) =>
  request(app.getHttpServer() as unknown as App);

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/ (GET)', async () => {
    const res = await makeRequest(app).get('/').expect(200);
    expect(res.text).toBe('Hello World!');
  });

  it('/nonexistent (GET) - should return standardized 404 error response', async () => {
    const res = await makeRequest(app).get('/nonexistent').expect(404);
    const body = res.body as ErrorResponse;

    expect(body.code).toBe(ErrorCode.SYS_NOT_FOUND);
    expect(body.message).toBeTruthy();
  });

  it('verifies test controller paths /test/* and /test-exception/* are not exposed', async () => {
    await makeRequest(app).get('/test/hello').expect(404);
    await makeRequest(app).get('/test-exception/http-exception').expect(404);
    await makeRequest(app).get('/test-exception/all-tests').expect(404);
  });
});
