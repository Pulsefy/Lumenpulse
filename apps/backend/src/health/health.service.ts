import { Injectable, Logger, Inject } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Horizon } from '@stellar/stellar-sdk';
import { DataSource } from 'typeorm';

@Injectable()
export class HealthService extends HealthIndicator {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private configService: ConfigService,
    private dataSource: DataSource,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {
    super();
  }

  /**
   * Check database connectivity via TypeORM DataSource
   * Critical service: if down, returns unhealthy status
   */
  async checkDatabase(): Promise<HealthIndicatorResult> {
    try {
      // Test the database connection
      if (!this.dataSource.isInitialized) {
        return this.getStatus('database', false, {
          message: 'Database connection not initialized',
        });
      }

      // Execute a simple query to verify connectivity
      await this.dataSource.query('SELECT 1');

      return this.getStatus('database', true);
    } catch (error) {
      this.logger.error('Database health check failed:', error);
      return this.getStatus('database', false, {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Check Redis connectivity through cache manager
   * Non-critical service: health check returns info but doesn't cause overall service degradation
   */
  async checkRedis(): Promise<HealthIndicatorResult> {
    try {
      if (!this.cacheManager) {
        return this.getStatus('redis', false, {
          message: 'Cache manager not initialized',
        });
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
        return this.getStatus('redis', true);
      } else {
        return this.getStatus('redis', false, {
          message: 'Redis value mismatch',
        });
      }
    } catch (error) {
      this.logger.warn('Redis health check failed:', error);
      return this.getStatus('redis', false, {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Check Stellar Horizon availability
   * Non-critical service: health check returns info but doesn't cause overall service degradation
   */
  async checkHorizon(): Promise<HealthIndicatorResult> {
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

      return this.getStatus('horizon', true, {
        url: horizonUrl,
      });
    } catch (error) {
      this.logger.warn('Horizon health check failed:', error);
      return this.getStatus('horizon', false, {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

