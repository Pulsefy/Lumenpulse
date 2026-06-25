import { Module } from '@nestjs/common';
import { TreasuryController } from './treasury.controller';
import { TreasuryService } from './treasury.service';
import { TreasurySorobanClient } from './treasury-soroban.client';
import { StellarModule } from '../stellar/stellar.module';

@Module({
  imports: [StellarModule],
  controllers: [TreasuryController],
  providers: [TreasuryService, TreasurySorobanClient],
  exports: [TreasuryService],
})
export class TreasuryModule {}

