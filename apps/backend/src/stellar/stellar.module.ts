import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import stellarConfig from './config/stellar.config';
import { StellarController } from './stellar.controller';
import { StellarService } from './stellar.service';
import { TransactionModule } from '../transaction/transaction.module';
import { ContractRotationService } from './services/contract-rotation.service';
import { StellarContractRotationService } from './services/stellar-contract-rotation.service';
import { AuditModule } from '../audit/audit.module';
import { AppConfigModule } from '../config/config.module';
import { SorobanRpcClientService } from './services/soroban-rpc-client.service';
import { MatchingPoolAdminController } from './controllers/matching-pool-admin.controller';
import { AppCacheModule } from '../cache/cache.module';
import { ResilienceService } from './services/resilience.service';

@Module({
  imports: [
    ConfigModule.forFeature(stellarConfig),
    TransactionModule,
    AuditModule,
    AppConfigModule,
    AppCacheModule,
  ],
  controllers: [StellarController, MatchingPoolAdminController],
  providers: [
    StellarService,
    SorobanRpcClientService,
    ContractRotationService,
    StellarContractRotationService,
    ResilienceService,
  ],
  exports: [
    StellarService,
    SorobanRpcClientService,
    ContractRotationService,
    StellarContractRotationService,
    ResilienceService,
  ],
})
export class StellarModule {}

