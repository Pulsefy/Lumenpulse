import { Module } from '@nestjs/common';
import { PriceGateway } from './price.gateway';
import { PriceService } from './price.service';
import { StellarModule } from '../stellar/stellar.module';

@Module({
  imports: [StellarModule],
  providers: [PriceGateway, PriceService],
  exports: [PriceService],
})
export class PriceModule {}
