import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TreasuryController } from './treasury.controller';
import { TreasuryService } from './treasury.service';
import { TreasurySorobanClient } from './treasury-soroban.client';
import { TreasuryBeneficiaryHistory } from './entities/treasury-beneficiary-history.entity';
import { AdminBlockchainAuditLog } from '../admin-audit/entities/admin-blockchain-audit-log.entity';
import { ContractAdminModule } from '../contract-admin/contract-admin.module';
import { StellarModule } from '../stellar/stellar.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TreasuryBeneficiaryHistory,
      AdminBlockchainAuditLog,
    ]),
    ContractAdminModule,
    StellarModule,
  ],
  controllers: [TreasuryController],
  providers: [TreasuryService, TreasurySorobanClient],
  exports: [TreasuryService],
})
export class TreasuryModule {}
