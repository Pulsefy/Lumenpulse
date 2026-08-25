import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContractAdminGuard } from '../common/guards/contract-admin.guard';
import { ContractAdminTrustedCallerGuard } from '../common/guards/contract-admin-trusted-caller.guard';
import { ContractAdminAuditService } from './contract-admin-audit.service';
import { AdminBlockchainAuditLog } from '../admin-audit/entities/admin-blockchain-audit-log.entity';
import { AccessControlModule } from '../common/access-control.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AdminBlockchainAuditLog]),
    AccessControlModule,
  ],
  providers: [
    ContractAdminGuard,
    ContractAdminTrustedCallerGuard,
    ContractAdminAuditService,
  ],
  exports: [
    ContractAdminGuard,
    ContractAdminTrustedCallerGuard,
    ContractAdminAuditService,
  ],
})
export class ContractAdminModule {}
