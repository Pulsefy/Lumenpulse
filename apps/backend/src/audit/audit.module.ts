import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditLogInterceptor } from './interceptors/audit-log.interceptor';
import { AuditScheduler } from './audit.scheduler';
import { UsersModule } from '../users/users.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { AdminBlockchainAuditLog } from '../admin-audit/entities/admin-blockchain-audit-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog, AdminBlockchainAuditLog]),
    forwardRef(() => UsersModule),
    SchedulerModule,
  ],
  controllers: [AuditController],
  providers: [AuditService, AuditLogInterceptor, AuditScheduler],
  exports: [AuditService, AuditLogInterceptor],
})
export class AuditModule {}
