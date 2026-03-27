import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import stellarConfig from './config/stellar.config';
import { StellarController } from './stellar.controller';
import { StellarService } from './stellar.service';

@Module({
  imports: [ConfigModule.forFeature(stellarConfig)],
  controllers: [StellarController],
  providers: [StellarService],
  exports: [StellarService],
})
export class StellarModule {}
