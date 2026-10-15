import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerModule } from '@nestjs/throttler';
import Keyv from 'keyv';
import request from 'supertest';
import { Server } from 'http';
import { MetricsService } from '../../metrics/metrics.service';
import {
  BOT_PRINCIPAL_CREDENTIALS,
  BotPrincipalService,
} from '../../bot-auth/bot-principal.service';
import {
  createThrottlerOptions,
  getRateLimitSettings,
} from './rate-limit.config';
import { RateLimitEndpointClass } from './rate-limit.decorator';
import { RateLimitGuard } from './rate-limit.guard';
import {
  RATE_LIMIT_JWT_SECRET,
  RateLimitPrincipalResolver,
} from './rate-limit.principal';
import {
  RATE_LIMIT_KEYV_STORE,
  RateLimitStorageService,
} from './rate-limit.storage';

const JWT_SECRET = 'rate-limit-guard-spec-secret';
const SMALL = { limit: 2, ttl: 60_000, blockDuration: 30_000 };

@Controller('rl')
class RateLimitTestController {
  @Get('trivial')
  @Throttle({ default: SMALL })
  trivial() {
    return { ok: true };
  }

  @Get('search-a')
  @Throttle({ default: SMALL })
  @RateLimitEndpointClass('searchRead')
  searchA() {
    return { ok: true };
  }

  @Get('search-b')
  @Throttle({ default: SMALL })
  @RateLimitEndpointClass('searchRead')
  searchB() {
    return { ok: true };
  }

  @Get('export')
  @Throttle({ default: { limit: 1, ttl: 60_000, blockDuration: 45_000 } })
  @RateLimitEndpointClass('exportJob')
  exportJob() {
    return { ok: true };
  }

  @Get('unclassified')
  unclassified() {
    return { ok: true };
  }
}

@Module({
  providers: [
    { provide: RATE_LIMIT_KEYV_STORE, useValue: new Keyv() },
    RateLimitStorageService,
  ],
  exports: [RateLimitStorageService],
})
class InMemoryRateLimitStorageModule {}

describe('RateLimitGuard (integration)', () => {
  let app: INestApplication;
  let metrics: MetricsService;
  const jwt = new JwtService({ secret: JWT_SECRET });
  const savedEnv: Record<string, string | undefined> = {};
  const overrides: Record<string, string> = {
    // Bot principals get their own (here: larger) search budget and a
    // different global budget; service principals get a tiny export budget.
    RATE_LIMIT_BOT_SEARCH_READ_LIMIT: '4',
    RATE_LIMIT_BOT_GLOBAL_LIMIT: '3',
    RATE_LIMIT_SERVICE_EXPORT_JOB_LIMIT: '2',
  };

  const server = (): Server => app.getHttpServer() as Server;
  const userToken = (sub: string) =>
    jwt.sign({ sub, type: 'access', stellarPublicKey: 'G...' });

  beforeAll(async () => {
    for (const [key, value] of Object.entries(overrides)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }

    metrics = new MetricsService();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRootAsync({
          imports: [InMemoryRateLimitStorageModule],
          inject: [RateLimitStorageService],
          useFactory: (storage: RateLimitStorageService) =>
            createThrottlerOptions(getRateLimitSettings(), storage),
        }),
      ],
      controllers: [RateLimitTestController],
      providers: [
        {
          provide: BOT_PRINCIPAL_CREDENTIALS,
          useValue: {
            botTokens: 'telegram-bot:bot-secret',
            serviceTokens: 'data-processing:svc-secret',
          },
        },
        BotPrincipalService,
        { provide: RATE_LIMIT_JWT_SECRET, useValue: JWT_SECRET },
        RateLimitPrincipalResolver,
        { provide: MetricsService, useValue: metrics },
        { provide: APP_GUARD, useClass: RateLimitGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const rejectionCount = async (endpointClass: string, principal: string) => {
    const metric = await metrics.registry
      .getSingleMetric('rate_limit_rejections_total')
      ?.get();
    const value = metric?.values.find(
      (v) =>
        v.labels.endpoint_class === endpointClass &&
        v.labels.principal_type === principal,
    );
    return value?.value ?? 0;
  };

  describe('principal scoping', () => {
    it('gives each authenticated user their own budget behind a shared source address', async () => {
      const alice = userToken('alice');
      const bob = userToken('bob');

      await request(server())
        .get('/rl/trivial')
        .auth(alice, { type: 'bearer' })
        .expect(200);
      await request(server())
        .get('/rl/trivial')
        .auth(alice, { type: 'bearer' })
        .expect(200);
      await request(server())
        .get('/rl/trivial')
        .auth(alice, { type: 'bearer' })
        .expect(429);

      // Same source address (supertest → 127.0.0.1) but a different principal.
      await request(server())
        .get('/rl/trivial')
        .auth(bob, { type: 'bearer' })
        .expect(200);

      // Anonymous callers from the same address are unaffected by the users'
      // consumption and are keyed by source address.
      await request(server()).get('/rl/trivial').expect(200);
      await request(server()).get('/rl/trivial').expect(200);
      await request(server()).get('/rl/trivial').expect(429);
    });

    it('falls back to source address for forged / invalid tokens', async () => {
      const forged = new JwtService({ secret: 'attacker' }).sign({ sub: 'x' });

      // Anonymous budget for /rl/trivial is already exhausted by the
      // previous test; a forged token must not mint a fresh budget.
      await request(server())
        .get('/rl/trivial')
        .auth(forged, { type: 'bearer' })
        .expect(429);
      await request(server())
        .get('/rl/trivial')
        .auth('not-a-jwt', { type: 'bearer' })
        .expect(429);
    });
  });

  describe('headers', () => {
    it('emits standard RateLimit-* headers and legacy X-RateLimit-* headers', async () => {
      const res = await request(server())
        .get('/rl/trivial')
        .auth(userToken('header-user'), { type: 'bearer' })
        .expect(200);

      expect(res.headers['ratelimit-limit']).toBe('2');
      expect(res.headers['ratelimit-remaining']).toBe('1');
      expect(Number(res.headers['ratelimit-reset'])).toBeGreaterThan(0);
      expect(res.headers['ratelimit-policy']).toBe('2;w=60');
      expect(res.headers['x-ratelimit-limit']).toBe('2');
      expect(res.headers['x-ratelimit-remaining']).toBe('1');
      expect(res.headers['retry-after']).toBeUndefined();
    });

    it('includes Retry-After (block duration) on rejection', async () => {
      const token = userToken('retry-user');
      await request(server())
        .get('/rl/export')
        .auth(token, { type: 'bearer' })
        .expect(200);
      const res = await request(server())
        .get('/rl/export')
        .auth(token, { type: 'bearer' })
        .expect(429);

      expect(Number(res.headers['retry-after'])).toBe(45);
      expect(res.headers['ratelimit-remaining']).toBe('0');
      expect(res.headers['ratelimit-reset']).toBe('45');
      const body = res.body as {
        details?: { retryAfterSeconds?: number; endpointClass?: string };
      };
      expect(body.details?.retryAfterSeconds).toBe(45);
      expect(body.details?.endpointClass).toBe('export');
    });
  });

  describe('expensive endpoint classes', () => {
    it('shares one bucket across every route of the class', async () => {
      const token = userToken('search-user');
      await request(server())
        .get('/rl/search-a')
        .auth(token, { type: 'bearer' })
        .expect(200);
      await request(server())
        .get('/rl/search-b')
        .auth(token, { type: 'bearer' })
        .expect(200);
      // Budget (2) is spent across both routes.
      await request(server())
        .get('/rl/search-a')
        .auth(token, { type: 'bearer' })
        .expect(429);
      await request(server())
        .get('/rl/search-b')
        .auth(token, { type: 'bearer' })
        .expect(429);
    });
  });

  describe('bot and service principals', () => {
    it('applies bot-specific limits to bot principals authenticated through bot-auth', async () => {
      for (let i = 0; i < 4; i += 1) {
        const res = await request(server())
          .get('/rl/search-a')
          .set('x-bot-token', 'bot-secret')
          .expect(200);
        expect(res.headers['ratelimit-limit']).toBe('4');
      }
      await request(server())
        .get('/rl/search-b')
        .set('x-bot-token', 'bot-secret')
        .expect(429);
    });

    it('applies service-specific limits to service principals', async () => {
      await request(server())
        .get('/rl/export')
        .set('x-service-token', 'svc-secret')
        .expect(200);
      await request(server())
        .get('/rl/export')
        .set('x-service-token', 'svc-secret')
        .expect(200);
      await request(server())
        .get('/rl/export')
        .set('x-service-token', 'svc-secret')
        .expect(429);
    });

    it('uses the bot global profile on unclassified routes', async () => {
      const res = await request(server())
        .get('/rl/unclassified')
        .set('x-bot-token', 'bot-secret')
        .expect(200);
      expect(res.headers['ratelimit-limit']).toBe('3');
    });

    it('never loosens a route with its own @Throttle override for bots', async () => {
      const bot = (path: string) =>
        request(server()).get(path).set('x-bot-token', 'bot-secret');
      await bot('/rl/trivial').expect(200);
      await bot('/rl/trivial').expect(200);
      await bot('/rl/trivial').expect(429);
    });

    it('recognises signed JWTs with a bot/service type claim', async () => {
      const botJwt = jwt.sign({ sub: 'jwt-bot', type: 'bot' });
      const res = await request(server())
        .get('/rl/unclassified')
        .auth(botJwt, { type: 'bearer' })
        .expect(200);
      expect(res.headers['ratelimit-limit']).toBe('3');
    });

    it('treats an unknown bot token as anonymous', async () => {
      const res = await request(server())
        .get('/rl/unclassified')
        .set('x-bot-token', 'wrong')
        .expect(200);
      // Standard (human) global limit rather than the bot global limit.
      expect(res.headers['ratelimit-limit']).toBe(
        String(getRateLimitSettings().global.limit),
      );
    });
  });

  describe('metrics', () => {
    it('exports rejections labelled by endpoint class and principal type', async () => {
      expect(await rejectionCount('default', 'user')).toBeGreaterThanOrEqual(1);
      expect(
        await rejectionCount('default', 'anonymous'),
      ).toBeGreaterThanOrEqual(1);
      expect(await rejectionCount('search', 'user')).toBe(2);
      expect(await rejectionCount('search', 'bot')).toBe(1);
      expect(await rejectionCount('export', 'user')).toBe(1);
      expect(await rejectionCount('export', 'service')).toBe(1);

      const exposition = await metrics.registry.metrics();
      expect(exposition).toContain('rate_limit_rejections_total');
      expect(exposition).toMatch(
        /rate_limit_rejections_total\{endpoint_class="export",principal_type="service"\} 1/,
      );
    });
  });
});
