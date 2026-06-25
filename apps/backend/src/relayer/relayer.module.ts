import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RelayerController } from './relayer.controller';
import { RelayerService } from './relayer.service';
import { StellarModule } from '../stellar/stellar.module';

@Module({
  imports: [ConfigModule, StellarModule],
  controllers: [RelayerController],
  providers: [RelayerService],
  exports: [RelayerService],
})
export class RelayerModule {}
