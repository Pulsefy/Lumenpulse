import { Module } from '@nestjs/common';
import { VestingWalletController } from './vesting-wallet.controller';
import { VestingWalletService } from './vesting-wallet.service';
import { VestingWalletSorobanClient } from './vesting-wallet-soroban.client';

@Module({
  controllers: [VestingWalletController],
  providers: [VestingWalletService, VestingWalletSorobanClient],
  exports: [VestingWalletService],
})
export class VestingWalletModule {}
