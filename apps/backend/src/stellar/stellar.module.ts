import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import stellarConfig from './config/stellar.config';
import { StellarController } from './stellar.controller';
import { StellarService } from './stellar.service';
import { TransactionModule } from '../transaction/transaction.module';

@Module({
  imports: [ConfigModule.forFeature(stellarConfig), TransactionModule],
  controllers: [StellarController],
  providers: [StellarService],
  exports: [StellarService],
})
export class StellarModule {}
