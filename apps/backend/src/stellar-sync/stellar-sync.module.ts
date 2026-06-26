import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { StellarSyncCheckpoint } from './entities/checkpoint.entity';
import { StellarProcessedEvent } from './entities/processed-event.entity';
import { StellarSyncProcessor } from './stellar-sync.processor';
import { StellarSyncService } from './stellar-sync.service';
import { ConfigModule } from '@nestjs/config';
import stellarConfig from '../stellar/config/stellar.config';

@Module({
  imports: [
    TypeOrmModule.forFeature([StellarSyncCheckpoint, StellarProcessedEvent]),
    BullModule.registerQueue({
      name: 'stellar-sync',
    }),
    ConfigModule.forFeature(stellarConfig),
  ],
  providers: [StellarSyncProcessor, StellarSyncService],
  exports: [StellarSyncService],
})
export class StellarSyncModule {}
