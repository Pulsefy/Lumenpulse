import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorage } from '@nestjs/throttler';
import { RateLimitGuard } from './rate-limit.guard';
import { getTrackerId, getRateLimitSettings } from './rate-limit.config';
import { MetricsService } from '../../metrics/metrics.service';

describe('RateLimitGuard & Config', () => {
  describe('getTrackerId (Principal Scoping)', () => {
    it('keys by authenticated user where req.user exists', () => {
      const req = {
        user: { id: 'usr_abc123', email: 'test@example.com' },
        ip: '192.168.1.50',
      };
      const key = getTrackerId(req, getRateLimitSettings());
      expect(key).toBe('user:usr_abc123');
    });

    it('keys by authenticated principal where req.principal exists', () => {
      const req = {
        principal: { id: 'principal_999' },
        ip: '192.168.1.50',
      };
      const key = getTrackerId(req, getRateLimitSettings());
      expect(key).toBe('principal:principal_999');
    });

    it('keys by bot-auth principal when req.bot exists', () => {
      const req = {
        bot: { id: 'telegram_bot_v1' },
        ip: '10.0.0.1',
      };
      const key = getTrackerId(req, getRateLimitSettings());
      expect(key).toBe('bot:telegram_bot_v1');
    });

    it('keys by bot-auth header (x-bot-id or x-bot-auth)', () => {
      const req = {
        headers: { 'x-bot-id': 'bot-service-01' },
        ip: '10.0.0.1',
      };
      const key = getTrackerId(req, getRateLimitSettings());
      expect(key).toBe('bot:bot-service-01');
    });

    it('keys by service-auth header (x-service-id)', () => {
      const req = {
        headers: { 'x-service-id': 'internal-analytics-svc' },
        ip: '10.0.0.1',
      };
      const key = getTrackerId(req, getRateLimitSettings());
      expect(key).toBe('service:internal-analytics-svc');
    });

    it('falls back to source IP address when unauthenticated', () => {
      const req = {
        ip: '203.0.113.45',
      };
      const key = getTrackerId(req, getRateLimitSettings());
      expect(key).toBe('ip:203.0.113.45');
    });
  });

  describe('RateLimitGuard Headers & Metrics', () => {
    let guard: RateLimitGuard;
    let mockMetricsService: Partial<MetricsService>;
    let mockStorage: Partial<ThrottlerStorage>;
    let mockReflector: Partial<Reflector>;

    class TestSearchController {}

    beforeEach(() => {
      mockMetricsService = {
        recordRateLimitRejection: jest.fn(),
      };
      mockStorage = {
        increment: jest.fn(),
      };
      mockReflector = {
        getAllAndOverride: jest.fn().mockReturnValue(undefined),
      };

      const options = {
        throttlers: [{ name: 'default', limit: 10, ttl: 60000, blockDuration: 60000 }],
      };

      guard = new RateLimitGuard(
        options,
        mockStorage as ThrottlerStorage,
        mockReflector as Reflector,
        mockMetricsService as MetricsService,
      );
    });

    it('sets Retry-After and standard rate limit headers on rejection and exports metric labelled by endpoint class', async () => {
      const headersMap: Record<string, string> = {};
      const mockReq = {
        ip: '127.0.0.1',
        method: 'GET',
        route: { path: '/search/projects' },
      };
      const mockRes = {
        setHeader: jest.fn((name: string, value: string) => {
          headersMap[name] = value;
        }),
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockReq,
          getResponse: () => mockRes,
        }),
        getClass: () => TestSearchController,
        getHandler: () => () => {},
      } as unknown as ExecutionContext;

      const detail = {
        limit: 10,
        ttl: 60000,
        totalHits: 11,
        timeToExpire: 45,
        isBlocked: true,
        timeToBlockExpire: 45,
      };

      try {
        await (guard as any).throwThrottlingException(mockContext, detail);
        fail('Should have thrown HttpException');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(HttpException);
        const httpErr = err as HttpException;
        expect(httpErr.getStatus()).toBe(429);

        // Verify headers set on response
        expect(mockRes.setHeader).toHaveBeenCalledWith('Retry-After', '45');
        expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '10');
        expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '0');
        expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', '45');

        // Verify metric exported labelled by endpoint class
        expect(mockMetricsService.recordRateLimitRejection).toHaveBeenCalledWith(
          'TestSearchController',
          'GET',
          '/search/projects',
        );
      }
    });
  });

  describe('Configured profiles', () => {
    it('provides separately configurable profiles for export, contract simulation, and bot-auth', () => {
      const settings = getRateLimitSettings();
      expect(settings.export).toBeDefined();
      expect(settings.contractSimulation).toBeDefined();
      expect(settings.botAuth).toBeDefined();
      expect(settings.export.limit).toBeGreaterThan(0);
      expect(settings.contractSimulation.limit).toBeGreaterThan(0);
      expect(settings.botAuth.limit).toBeGreaterThan(0);
    });
  });
});
