import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { BlockchainAuditLog } from './entities/blockchain-audit-log.entity';
import { AuditService } from './audit.service';
import { BlockchainAuditService } from './blockchain-audit.service';
import { AuditController } from './audit.controller';
import { BlockchainAuditController } from './blockchain-audit.controller';
import { AuditLogInterceptor } from './interceptors/audit-log.interceptor';
import { BlockchainAuditInterceptor } from './interceptors/blockchain-audit.interceptor';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog, BlockchainAuditLog]),
    forwardRef(() => UsersModule),
  ],
  controllers: [AuditController, BlockchainAuditController],
  providers: [
    AuditService,
    BlockchainAuditService,
    AuditLogInterceptor,
    BlockchainAuditInterceptor,
  ],
  exports: [
    AuditService,
    BlockchainAuditService,
    AuditLogInterceptor,
    BlockchainAuditInterceptor,
  ],
})
export class AuditModule {}
