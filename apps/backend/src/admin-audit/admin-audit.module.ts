import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminBlockchainAuditLog } from './entities/admin-blockchain-audit-log.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AdminAuditService } from './admin-audit.service';
import { AdminAuditController } from './admin-audit.controller';
import { AdminAuditInterceptor } from './interceptors/admin-audit.interceptor';

@Module({
  imports: [TypeOrmModule.forFeature([AdminBlockchainAuditLog, AuditLog])],
  providers: [AdminAuditService, AdminAuditInterceptor],
  controllers: [AdminAuditController],
  exports: [AdminAuditService, AdminAuditInterceptor],
})
export class AdminAuditModule {}
