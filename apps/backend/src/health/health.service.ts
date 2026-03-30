import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Horizon } from '@stellar/stellar-sdk';

export interface ServiceHealthStatus {
  status: 'up' | 'down';
  message?: string;
  url?: string;
}

export type HealthCheckResult = Record<string, ServiceHealthStatus>;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private configService: ConfigService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  /**
   * Check database connectivity via TCP
   * Critical service: if down, affects overall service health
   */
  async checkDatabase(): Promise<HealthCheckResult> {
    try {
      const dbHost = this.configService.get<string>('DB_HOST', 'localhost');
      const dbPort = this.configService.get<string>('DB_PORT', '5432');

      // Try to establish a TCP connection to the database
      const isHealthy = await this.checkTcpConnection(dbHost, dbPort);

      if (isHealthy) {
        return {
          database: {
            status: 'up',
          },
        };
      } else {
        return {
          database: {
            status: 'down',
            message: `Unable to connect to database at ${dbHost}:${dbPort}`,
          },
        };
      }
    } catch (error) {
      this.logger.error('Database health check failed:', error);
      return {
        database: {
          status: 'down',
          message:
            error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Check Redis connectivity through cache manager
   * Non-critical service: health check returns info but doesn't cause overall service degradation
   */
  async checkRedis(): Promise<HealthCheckResult> {
    try {
      if (!this.cacheManager) {
        return {
          redis: {
            status: 'down',
            message: 'Cache manager not initialized',
          },
        };
      }

      // Test Redis by setting and getting a health check key
      const healthCheckKey = '__health_check__';
      const testValue = Date.now().toString();

      // Set a test value
      await this.cacheManager.set(healthCheckKey, testValue, 5000); // 5 second TTL

      // Retrieve the test value
      const retrievedValue = await this.cacheManager.get(healthCheckKey);

      // Clean up
      await this.cacheManager.del(healthCheckKey);

      if (retrievedValue === testValue) {
        return {
          redis: {
            status: 'up',
          },
        };
      } else {
        return {
          redis: {
            status: 'down',
            message: 'Redis value mismatch',
          },
        };
      }
    } catch (error) {
      this.logger.warn('Redis health check failed:', error);
      return {
        redis: {
          status: 'down',
          message:
            error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Check Stellar Horizon availability
   * Non-critical service: health check returns info but doesn't cause overall service degradation
   */
  async checkHorizon(): Promise<HealthCheckResult> {
    try {
      const horizonUrl = this.configService.get<string>(
        'STELLAR_HORIZON_URL',
        'https://horizon.stellar.org',
      );

      // Create a temporary Horizon server instance
      const server = new Horizon.Server(horizonUrl, {
        allowHttp: horizonUrl.startsWith('http://'),
        timeout: 5000, // 5 second timeout for health check
      });

      // Test the connection by fetching ledger info
      const ledgerCallBuilder = server.ledgers().limit(1);
      await ledgerCallBuilder.call();

      return {
        horizon: {
          status: 'up',
          url: horizonUrl,
        },
      };
    } catch (error) {
      this.logger.warn('Horizon health check failed:', error);
      return {
        horizon: {
          status: 'down',
          message:
            error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Check Redis connectivity with graceful degradation
   * Returns status even on failure - doesn't throw errors
   */
  async checkRedisGraceful(): Promise<HealthCheckResult> {
    try {
      return await this.checkRedis();
    } catch (error) {
      this.logger.warn('Redis health check error (non-critical), continuing...');
      return {
        redis: {
          status: 'down',
          message: 'Redis unavailable but non-critical',
        },
      };
    }
  }

  /**
   * Check Stellar Horizon with graceful degradation
   * Returns status even on failure - doesn't throw errors
   */
  async checkHorizonGraceful(): Promise<HealthCheckResult> {
    try {
      return await this.checkHorizon();
    } catch (error) {
      this.logger.warn('Horizon health check error (non-critical), continuing...');
      return {
        horizon: {
          status: 'down',
          message: 'Horizon unavailable but non-critical',
        },
      };
    }
  }

  /**
   * Simple TCP connection check to determine if a service is reachable
   * Used for database connectivity verification
   */
  private async checkTcpConnection(
    host: string,
    port: string,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const net = require('net');
      const socket = new net.Socket();
      const timeout = 5000; // 5 second timeout

      socket.setTimeout(timeout);

      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', () => {
        resolve(false);
      });

      socket.connect(parseInt(port), host);
    });
  }
}

