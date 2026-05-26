import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';

import { AccountOperation } from './entities/account-operation.entity';
import { HorizonIngestCheckpoint } from './entities/horizon-ingest-checkpoint.entity';
import { HorizonIngestProcessor } from './horizon-ingest.processor';
import { HorizonIngestService } from './horizon-ingest.service';
import { HorizonIngestController } from './horizon-ingest.controller';
import horizonIngestConfig from './config/horizon-ingest.config';

@Module({
  imports: [
    TypeOrmModule.forFeature([AccountOperation, HorizonIngestCheckpoint]),
    BullModule.registerQueue({
      name: 'horizon-ingest',
    }),
    ConfigModule.forFeature(horizonIngestConfig),
  ],
  controllers: [HorizonIngestController],
  providers: [HorizonIngestProcessor, HorizonIngestService],
  exports: [HorizonIngestService],
})
export class HorizonIngestModule {}
