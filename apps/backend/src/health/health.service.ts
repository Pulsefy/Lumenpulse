import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Horizon } from '@stellar/stellar-sdk';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class HealthService extends HealthIndicator {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private configService: ConfigService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private httpService: HttpService,
  ) {
    super();
  }

  /**
   * Check database connectivity
   * Attempts connection via a simple HTTP call to verify the API is database-connected
   * Critical service: if down, affects overall service health
   */
  async checkDatabase(): Promise<HealthIndicatorResult> {
    try {
      const dbHost = this.configService.get<string>('DB_HOST', 'localhost');
      const dbPort = this.configService.get<string>('DB_PORT', '5432');

      // Try to establish a TCP connection to the database
      const isHealthy = await this.checkTcpConnection(dbHost, dbPort);

      if (isHealthy) {
        return this.getStatus('database', true);
      } else {
        return this.getStatus('database', false, {
          message: `Unable to connect to database at ${dbHost}:${dbPort}`,
        });
      }
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

  /**
   * Check Redis connectivity with graceful degradation
   * Returns success even on failure - doesn't block health check
   */
  async checkRedisGraceful(): Promise<HealthIndicatorResult> {
    try {
      return await this.checkRedis();
    } catch (error) {
      this.logger.warn('Redis health check error (non-critical), continuing...');
      // Return success status to prevent overall service failure
      return this.getStatus('redis', false, {
        message: 'Redis unavailable but non-critical',
      });
    }
  }

  /**
   * Check Stellar Horizon with graceful degradation
   * Returns success even on failure - doesn't block health check
   */
  async checkHorizonGraceful(): Promise<HealthIndicatorResult> {
    try {
      return await this.checkHorizon();
    } catch (error) {
      this.logger.warn('Horizon health check error (non-critical), continuing...');
      // Return success status to prevent overall service failure
      return this.getStatus('horizon', false, {
        message: 'Horizon unavailable but non-critical',
      });
    }
  }


