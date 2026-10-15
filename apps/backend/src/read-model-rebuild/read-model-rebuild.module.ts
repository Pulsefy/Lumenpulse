import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ScheduleModule } from '@nestjs/schedule';
import { ReadModelRebuildController } from './read-model-rebuild.controller';
import { ReadModelRebuildService } from './read-model-rebuild.service';
import { ReadModelRebuildScheduler } from './read-model-rebuild.scheduler';
import { ReadModelRebuildJob } from './entities/read-model-rebuild-job.entity';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReadModelRebuildJob]),
    ScheduleModule.forRoot(),
    SchedulerModule,
    AdminAuditModule,
    AuthModule,
    HttpModule.register({
      timeout: 300000, // 5 minutes for long-running rebuilds
      maxRedirects: 5,
    }),
  ],
  controllers: [ReadModelRebuildController],
  providers: [ReadModelRebuildService, ReadModelRebuildScheduler],
  exports: [ReadModelRebuildService],
})
export class ReadModelRebuildModule {}
