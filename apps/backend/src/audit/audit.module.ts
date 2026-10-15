import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditLogInterceptor } from './interceptors/audit-log.interceptor';
import { UsersModule } from '../users/users.module';
import { AuditLogArchive } from './entities/audit-log-archive.entity';
import { AdminBlockchainAuditLog } from '../admin-audit/entities/admin-blockchain-audit-log.entity';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { AuditExportService } from './export/audit-export.service';
import { AuditRetentionService } from './retention/audit-retention.service';
import { AuditRetentionScheduler } from './retention/audit-retention.scheduler';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuditLog,
      AuditLogArchive,
      AdminBlockchainAuditLog,
    ]),
    forwardRef(() => UsersModule),
    SchedulerModule,
  ],
  controllers: [AuditController],
  providers: [
    AuditService,
    AuditLogInterceptor,
    AuditExportService,
    AuditRetentionService,
    AuditRetentionScheduler,
  ],
  exports: [AuditService, AuditLogInterceptor],
})
export class AuditModule {}
