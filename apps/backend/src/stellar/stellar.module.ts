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

@Module({
  imports: [
    ConfigModule.forFeature(stellarConfig),
    TransactionModule,
    AuditModule,
    AppConfigModule,
  ],
  controllers: [StellarController],
  providers: [
    StellarService,
    ContractRotationService,
    StellarContractRotationService,
  ],
  exports: [
    StellarService,
    ContractRotationService,
    StellarContractRotationService,
  ],
})
export class StellarModule {}
