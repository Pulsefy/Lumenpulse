import {
  Body,
  Controller,
  Get,
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
  Post,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { Server } from 'http';
import { Throttle, ThrottlerModule } from '@nestjs/throttler';
import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import request from 'supertest';
import { setupApp } from '../src/bootstrap/app.setup';
import { REQUEST_ID_HEADER } from '../src/common/constants/request.constants';
import { ErrorCode } from '../src/common/enums/error-code.enum';
import {
  createThrottlerOptions,
  getRateLimitSettings,
} from '../src/common/rate-limit/rate-limit.config';
import { RateLimitGuard } from '../src/common/rate-limit/rate-limit.guard';
import { RateLimitModule } from '../src/common/rate-limit/rate-limit.module';
import { RateLimitStorageService } from '../src/common/rate-limit/rate-limit.storage';
import { RequestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { ErrorResponse } from '../src/interfaces/error-response.interface';

class DemoPayloadDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsInt()
  @Min(1)
  count: number;
}

@Controller('security-test')
class SecurityTestController {
  @Post('validate')
  validate(@Body() payload: DemoPayloadDto) {
    return {
      ok: true,
      payload,
    };
  }

  @Get('limited')
  @Throttle({
    default: {
      limit: 2,
      ttl: 60_000,
      blockDuration: 60_000,
    },
  })
  limited() {
    return { ok: true };
  }

  @Get('error')
  crash() {
    throw new Error('database connection string leaked');
  }
}

@Module({
  imports: [
    RateLimitModule,
    ThrottlerModule.forRootAsync({
      imports: [RateLimitModule],
      inject: [RateLimitStorageService],
      useFactory: (storageService: RateLimitStorageService) =>
        createThrottlerOptions(getRateLimitSettings(), storageService),
    }),
  ],
  controllers: [SecurityTestController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
  ],
})
class SecurityTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}

describe('Security hardening (e2e)', () => {
  let app: INestApplication;
  let originalNodeEnv: string | undefined;
  let originalTrackByApiKey: string | undefined;
  let originalCorsOrigin: string | undefined;

  const getHttpServer = (): Server => app.getHttpServer() as Server;

  beforeAll(async () => {
    originalNodeEnv = process.env.NODE_ENV;
    originalTrackByApiKey = process.env.RATE_LIMIT_TRACK_BY_API_KEY;
    originalCorsOrigin = process.env.CORS_ORIGIN;
    process.env.NODE_ENV = 'production';
    process.env.RATE_LIMIT_TRACK_BY_API_KEY = 'true';
    process.env.CORS_ORIGIN = 'http://localhost:3000';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [SecurityTestModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    setupApp(app);
    await app.init();
  });

  afterAll(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.RATE_LIMIT_TRACK_BY_API_KEY = originalTrackByApiKey;
    process.env.CORS_ORIGIN = originalCorsOrigin;
    await app.close();
  });

  it('returns a standardized 400 response for invalid DTO payloads', async () => {
    const response = await request(getHttpServer())
      .post('/security-test/validate')
      .send({
        name: '',
        count: 0,
        unexpected: 'value',
      })
      .expect(400);

    const body = response.body as ErrorResponse;

    expect(body.code).toBe(ErrorCode.SYS_VALIDATION_FAILED);
    expect(body.message).toBe('Validation failed');
    expect(body.requestId).toBeTruthy();
    expect(response.headers['x-request-id']).toBe(body.requestId);
    expect(body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'name' }),
        expect.objectContaining({ field: 'count' }),
        expect.objectContaining({ field: 'unexpected' }),
      ]),
    );
  });

  it('returns 429 after repeated requests from the same api key', async () => {
    const apiKey = 'test-public-key';

    await request(getHttpServer())
      .get('/security-test/limited')
      .set('x-api-key', apiKey)
      .expect(200);
    await request(getHttpServer())
      .get('/security-test/limited')
      .set('x-api-key', apiKey)
      .expect(200);

    const response = await request(getHttpServer())
      .get('/security-test/limited')
      .set('x-api-key', apiKey)
      .expect(429);

    const body = response.body as ErrorResponse;

    expect(body.code).toBe(ErrorCode.SYS_RATE_LIMIT_EXCEEDED);
    expect(body.message).toBe('Too many requests. Please try again later.');
    expect(body.requestId).toBeTruthy();
    expect(response.headers['retry-after']).toBeDefined();
    expect(response.headers[REQUEST_ID_HEADER.toLowerCase()]).toBe(
      body.requestId,
    );
  });

  it('does not expose internal error details in production mode', async () => {
    const response = await request(getHttpServer())
      .get('/security-test/error')
      .expect(500);

    const body = response.body as ErrorResponse;

    expect(body.code).toBe(ErrorCode.SYS_INTERNAL_ERROR);
    expect(body.message).toBe('Internal server error');
    expect(body.details).toBeUndefined();
    expect(body.requestId).toBeTruthy();
  });
});
