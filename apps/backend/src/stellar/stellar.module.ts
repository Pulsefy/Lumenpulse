import { Module, forwardRef } from '@nestjs/common';
import { Registry } from 'prom-client';
import { MetricsService } from '../metrics/metrics.service';
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
import { SimulationCacheService } from './services/simulation-cache.service';
import { HorizonClientService } from './services/horizon-client.service';
import { MatchingPoolAdminController } from './controllers/matching-pool-admin.controller';
import { TestnetBootstrapController } from './controllers/testnet-bootstrap.controller';
import { TestnetBootstrapService } from './services/testnet-bootstrap.service';
import { AppCacheModule } from '../cache/cache.module';

@Module({
  imports: [
    ConfigModule.forFeature(stellarConfig),
    forwardRef(() => TransactionModule),
    AuditModule,
    AppConfigModule,
    AppCacheModule,
  ],
  controllers: [
    StellarController,
    MatchingPoolAdminController,
    TestnetBootstrapController,
  ],
  providers: [
    StellarService,
    SorobanRpcClientService,
    SimulationCacheService,
    HorizonClientService,
    ContractRotationService,
    StellarContractRotationService,
    TestnetBootstrapService,
    {
      provide: Registry,
      useFactory: (metricsService: MetricsService) => metricsService.registry,
      inject: [MetricsService],
    },
  ],
  exports: [
    StellarService,
    SorobanRpcClientService,
    SimulationCacheService,
    HorizonClientService,
    ContractRotationService,
    StellarContractRotationService,
    TestnetBootstrapService,
  ],
})
export class StellarModule {}
