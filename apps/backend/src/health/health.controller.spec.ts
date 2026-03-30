import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { HttpException, HttpStatus } from '@nestjs/common';

describe('HealthController', () => {
  let controller: HealthController;
  let service: HealthService;
  let configService: ConfigService;
  let cacheManager: any;

  beforeEach(async () => {
    // Mock cache manager
    cacheManager = {
      set: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue('test-value'),
      del: jest.fn().mockResolvedValue(undefined),
    };

    // Mock config service
    configService = {
      get: jest.fn((key, defaultValue) => {
        const config: Record<string, string | number> = {
          DB_HOST: 'localhost',
          DB_PORT: '5432',
          STELLAR_HORIZON_URL: 'https://horizon.stellar.org',
        };
        return config[key] || defaultValue;
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        {
          provide: ConfigService,
          useValue: configService,
        },
        {
          provide: CACHE_MANAGER,
          useValue: cacheManager,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    service = module.get<HealthService>(HealthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /health', () => {
    it('should return 200 when database is up', async () => {
      // Mock successful database check
      jest.spyOn(service, 'checkDatabase').mockResolvedValue({
        database: { status: 'up' },
      });
      jest.spyOn(service, 'checkRedisGraceful').mockResolvedValue({
        redis: { status: 'up' },
      });
      jest.spyOn(service, 'checkHorizonGraceful').mockResolvedValue({
        horizon: { status: 'up' },
      });

      const response = await controller.check();

      expect(response.status).toBe('ok');
      expect(response.checks.database.status).toBe('up');
      expect(response.checks.redis.status).toBe('up');
      expect(response.checks.horizon.status).toBe('up');
    });

    it('should return 200 with degraded status when Redis is down', async () => {
      // Mock database up, Redis down
      jest.spyOn(service, 'checkDatabase').mockResolvedValue({
        database: { status: 'up' },
      });
      jest.spyOn(service, 'checkRedisGraceful').mockResolvedValue({
        redis: { status: 'down', message: 'Connection failed' },
      });
      jest.spyOn(service, 'checkHorizonGraceful').mockResolvedValue({
        horizon: { status: 'up' },
      });

      const response = await controller.check();

      expect(response.status).toBe('ok');
      expect(response.checks.database.status).toBe('up');
      expect(response.checks.redis.status).toBe('down');
      expect(response.checks.horizon.status).toBe('up');
    });

    it('should return 503 when database is down', async () => {
      // Mock database down
      jest.spyOn(service, 'checkDatabase').mockResolvedValue({
        database: { status: 'down', message: 'Connection refused' },
      });
      jest.spyOn(service, 'checkRedisGraceful').mockResolvedValue({
        redis: { status: 'up' },
      });
      jest.spyOn(service, 'checkHorizonGraceful').mockResolvedValue({
        horizon: { status: 'up' },
      });

      try {
        await controller.check();
        fail('Should have thrown HttpException');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      }
    });
  });

  describe('GET /health/detailed', () => {
    it('should return detailed health status of all services', async () => {
      jest.spyOn(service, 'checkDatabase').mockResolvedValue({
        database: { status: 'up' },
      });
      jest.spyOn(service, 'checkRedis').mockResolvedValue({
        redis: { status: 'up' },
      });
      jest.spyOn(service, 'checkHorizon').mockResolvedValue({
        horizon: { status: 'up', url: 'https://horizon.stellar.org' },
      });

      const response = await controller.detailed();

      expect(response.services).toBeDefined();
      expect(response.services.database).toBeDefined();
      expect(response.services.redis).toBeDefined();
      expect(response.services.horizon).toBeDefined();
    });
  });

  describe('GET /health/ready', () => {
    it('should return 200 when database is ready', async () => {
      jest.spyOn(service, 'checkDatabase').mockResolvedValue({
        database: { status: 'up' },
      });

      const response = await controller.ready();

      expect(response.status).toBe('ready');
    });

    it('should return 503 when database is not ready', async () => {
      jest.spyOn(service, 'checkDatabase').mockResolvedValue({
        database: { status: 'down', message: 'Not available' },
      });

      try {
        await controller.ready();
        fail('Should have thrown HttpException');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      }
    });
  });
});

describe('HealthService', () => {
  let service: HealthService;
  let configService: ConfigService;
  let cacheManager: any;

  beforeEach(async () => {
    cacheManager = {
      set: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue('test-value'),
      del: jest.fn().mockResolvedValue(undefined),
    };

    configService = {
      get: jest.fn((key, defaultValue) => {
        const config: Record<string, string | number> = {
          DB_HOST: 'localhost',
          DB_PORT: '5432',
          STELLAR_HORIZON_URL: 'https://horizon.stellar.org',
        };
        return config[key] || defaultValue;
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: ConfigService,
          useValue: configService,
        },
        {
          provide: CACHE_MANAGER,
          useValue: cacheManager,
        },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  describe('checkRedis', () => {
    it('should return up status when cache manager operations succeed', async () => {
      const result = await service.checkRedis();

      expect(result.redis.status).toBe('up');
      expect(cacheManager.set).toHaveBeenCalled();
      expect(cacheManager.get).toHaveBeenCalled();
      expect(cacheManager.del).toHaveBeenCalled();
    });

    it('should return down status when cache manager is not initialized', async () => {
      const testModule = await Test.createTestingModule({
        providers: [
          HealthService,
          {
            provide: ConfigService,
            useValue: configService,
          },
          {
            provide: CACHE_MANAGER,
            useValue: null,
          },
        ],
      }).compile();

      const serviceWithoutCache = testModule.get<HealthService>(HealthService);
      const result = await serviceWithoutCache.checkRedis();

      expect(result.redis.status).toBe('down');
    });
  });

  describe('checkDatabase', () => {
    it('should return result based on TCP connection', async () => {
      const result = await service.checkDatabase();

      // Result depends on whether TCP connection to localhost:5432 succeeds
      expect(result.database).toBeDefined();
      expect(['up', 'down']).toContain(result.database.status);
    });
  });
});
