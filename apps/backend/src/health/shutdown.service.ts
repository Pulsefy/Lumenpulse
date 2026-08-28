import {
  Injectable,
  Logger,
  OnModuleDestroy,
  BeforeApplicationShutdown,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { config } from '../lib/config';

@Injectable()
export class ShutdownService
  implements OnModuleDestroy, BeforeApplicationShutdown
{
  private readonly logger = new Logger(ShutdownService.name);
  private shuttingDown = false;

  constructor(private readonly schedulerRegistry: SchedulerRegistry) {}

  public isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  // mark as async so we can await job.stop() (prevents no-floating-promises)
  async onModuleDestroy(): Promise<void> {
    this.logger.log('Application is destroying modules. Stopping schedulers...');
    try {
      // schedulerRegistry.getCronJobs() returns a Map-like iterable
      // iterate and await each stop call to avoid floating promises
      for (const [name, job] of this.schedulerRegistry.getCronJobs()) {
        this.logger.log(`Stopping cron job: ${name}`);
        // await even if stop may be synchronous — this is safe
        await job.stop();
      }
    } catch (err: unknown) {
      // narrow unknown before using it to avoid unsafe assignment/usage
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to stop cron jobs: ${errorMessage}`);
    }
  }

  async beforeApplicationShutdown(signal?: string) {
    this.logger.log(
      `Received ${signal}. Starting graceful shutdown sequence...`,
    );
    this.shuttingDown = true;

    // Use the correctly typed config value
    const gracePeriodMs = config.shutdownGracePeriodMs;

    if (gracePeriodMs > 0) {
      this.logger.log(
        `Readiness probe is now unready. Waiting ${gracePeriodMs}ms for inflight requests to drain...`,
      );
      // Use a Promise wrapper with setTimeout; gracePeriodMs is now a number
      await new Promise<void>((resolve) => setTimeout(resolve, gracePeriodMs));
      this.logger.log('Drain period completed. Proceeding to close HTTP server and database connections.');
    }
  }
}
