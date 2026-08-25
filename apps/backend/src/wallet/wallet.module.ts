import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { StellarModule } from '../stellar/stellar.module';
import { AppCacheModule } from '../cache/cache.module';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [StellarModule, AppCacheModule, MetricsModule],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
