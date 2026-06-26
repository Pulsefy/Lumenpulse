import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import stellarConfig from '../stellar/config/stellar.config';
import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';

@Module({
  imports: [NestConfigModule.forFeature(stellarConfig)],
  controllers: [ConfigController],
  providers: [ConfigService],
  exports: [ConfigService],
})
export class AppConfigModule {}
