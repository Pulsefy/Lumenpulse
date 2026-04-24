import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ExchangeRatesService } from './exchange-rates.service';
import { AppCacheModule } from '../cache/cache.module';

@Module({
  imports: [HttpModule, AppCacheModule],
  providers: [ExchangeRatesService],
  exports: [ExchangeRatesService],
})
export class ExchangeRatesModule {}
