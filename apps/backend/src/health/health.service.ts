import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import * as redis from 'redis';
import { Horizon } from '@stellar/stellar-sdk';
import { DataSource } from 'typeorm';

@Injectable()
export class HealthService extends HealthIndicator {
  private readonly logger = new Logger(HealthService.name);
  private redisClient: redis.RedisClientType;

  constructor(
    private configService: ConfigService,
    private dataSource: DataSource,
  ) {
    super();
    this.initializeRedisClient();
  }

  /**
   * Initialize Redis client for health checks
   */
  private initializeRedisClient(): void {
    try {
      const host = this.configService.get<string>('REDIS_HOST', 'localhost');
      const port = this.configService.get<number>('REDIS_PORT', 6379);

      this.redisClient = redis.createClient({
        socket: {
          host,
          port,
          reconnectStrategy: (retries) => Math.min(retries * 50, 500),
        },
        // Do not connect immediately; connect on demand for health checks
        lazyConnect: true,
      });

      this.redisClient.on('error', (err) => {
        this.logger.error('Redis client error:', err);
      });
    } catch (error) {
      this.logger.error('Failed to initialize Redis client:', error);
    }
  }

  /**
   * Check database connectivity via TypeORM DataSource
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
   * Check Redis connectivity
   * Non-critical service: health check returns info but doesn't cause service degradation
   */
  async checkRedis(): Promise<HealthIndicatorResult> {
    try {
      if (!this.redisClient) {
        return this.getStatus('redis', false, {
          message: 'Redis client not initialized',
        });
      }

      // Connect if not already connected
      if (!this.redisClient.isOpen) {
        await this.redisClient.connect();
      }

      // Ping Redis to verify connectivity
      const pong = await this.redisClient.ping();

      // Disconnect after health check
      if (this.redisClient.isOpen) {
        await this.redisClient.disconnect();
      }

      return this.getStatus('redis', pong === 'PONG');
    } catch (error) {
      this.logger.warn('Redis health check failed:', error);
      return this.getStatus('redis', false, {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Check Stellar Horizon availability
   * Non-critical service: health check returns info but doesn't cause service degradation
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
