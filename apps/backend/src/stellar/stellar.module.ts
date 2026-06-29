import { Module, forwardRef } from '@nestjs/common';
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
<<<<<<< Updated upstream
import { AppCacheModule } from '../cache/cache.module';
=======
import { SimulationTraceLogger } from './services/simulation-trace-logger.service';
>>>>>>> Stashed changes

@Module({
  imports: [
    ConfigModule.forFeature(stellarConfig),
    forwardRef(() => TransactionModule),
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
    SimulationTraceLogger,
  ],
  exports: [
    StellarService,
    SorobanRpcClientService,
    ContractRotationService,
    StellarContractRotationService,
    SimulationTraceLogger,
  ],
})
export class StellarModule {}
