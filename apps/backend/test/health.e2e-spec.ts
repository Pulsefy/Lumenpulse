import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Health Check (e2e)', () => {
  let app: INestApplication;

  // Step 1: Bootstrap the app in memory before running tests
  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Apply global pipes if used in AppModule (keeps consistency)
    app.useGlobalPipes(new ValidationPipe());

    await app.init();
  });

  // Step 2: Close the app after all tests
  afterAll(async () => {
    await app.close();
    await new Promise(resolve => setTimeout(resolve, 500)); // optional small delay to allow cleanup
  });

  // Step 3: The actual Health Check test
  it('GET / should return Hello World!', () => {
    return request(app.getHttpServer())
      .get('/') // matches AppController route
      .expect(200)
      .expect('Hello World!');
  });
});
