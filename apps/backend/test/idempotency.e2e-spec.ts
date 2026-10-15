import { Test, TestingModule } from '@nestjs/testing';
import { Body, Controller, INestApplication, Post } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_INTERCEPTOR } from '@nestjs/core';
import request from 'supertest';
import { App } from 'supertest/types';
import { IdempotencyModule } from '../src/idempotency/idempotency.module';
import { IdempotencyInterceptor } from '../src/common/interceptors/idempotency.interceptor';
import { Idempotent } from '../src/common/decorators/idempotent.decorator';
import databaseConfig from '../src/database/database.config';

@Controller('idempotency-test')
class IdempotencyTestController {
  public executions = 0;

  @Post('slow')
  @Idempotent()
  async slowCreate(@Body() body: Record<string, unknown>) {
    this.executions += 1;
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { received: body, executions: this.executions };
  }

  @Post('expiring')
  @Idempotent({ ttl: 300 })
  expiringCreate(@Body() body: Record<string, unknown>) {
    this.executions += 1;
    return { received: body, executions: this.executions };
  }
}

interface TestResponseBody {
  received: Record<string, unknown>;
  executions: number;
}

const makeRequest = (app: INestApplication) =>
  request(app.getHttpServer() as unknown as App);

describe('Idempotency (e2e)', () => {
  let app: INestApplication;
  let controller: IdempotencyTestController;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [databaseConfig],
        }),
        TypeOrmModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (configService: ConfigService) => ({
            ...configService.get<Record<string, unknown>>('database'),
            autoLoadEntities: true,
            synchronize: true,
          }),
        }),
        ScheduleModule.forRoot(),
        IdempotencyModule,
      ],
      controllers: [IdempotencyTestController],
      providers: [
        {
          provide: APP_INTERCEPTOR,
          useClass: IdempotencyInterceptor,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    controller = app.get(IdempotencyTestController);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    controller.executions = 0;
  });

  it('replays the original response for a repeated key without re-executing', async () => {
    const first = await makeRequest(app)
      .post('/idempotency-test/slow')
      .set('Idempotency-Key', 'replay-key')
      .send({ amount: 100 });

    expect(first.status).toBe(201);
    expect((first.body as TestResponseBody).executions).toBe(1);

    const second = await makeRequest(app)
      .post('/idempotency-test/slow')
      .set('Idempotency-Key', 'replay-key')
      .send({ amount: 100 });

    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(controller.executions).toBe(1);
  });

  it('rejects reusing a key with a different body', async () => {
    await makeRequest(app)
      .post('/idempotency-test/slow')
      .set('Idempotency-Key', 'mismatch-key')
      .send({ amount: 100 })
      .expect(201);

    const response = await makeRequest(app)
      .post('/idempotency-test/slow')
      .set('Idempotency-Key', 'mismatch-key')
      .send({ amount: 200 });

    expect(response.status).toBe(422);
  });

  it('serialises concurrent requests with the same key so only one executes', async () => {
    const [first, second] = await Promise.all([
      makeRequest(app)
        .post('/idempotency-test/slow')
        .set('Idempotency-Key', 'concurrent-key')
        .send({ amount: 100 }),
      makeRequest(app)
        .post('/idempotency-test/slow')
        .set('Idempotency-Key', 'concurrent-key')
        .send({ amount: 100 }),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body).toEqual(second.body);
    expect(controller.executions).toBe(1);
  });

  it('does not replay a key whose retention window has expired', async () => {
    await makeRequest(app)
      .post('/idempotency-test/expiring')
      .set('Idempotency-Key', 'expiring-key')
      .send({ amount: 100 })
      .expect(201);

    await new Promise((resolve) => setTimeout(resolve, 400));

    const response = await makeRequest(app)
      .post('/idempotency-test/expiring')
      .set('Idempotency-Key', 'expiring-key')
      .send({ amount: 100 });

    expect(response.status).toBe(201);
    expect((response.body as TestResponseBody).executions).toBe(2);
  });
});
