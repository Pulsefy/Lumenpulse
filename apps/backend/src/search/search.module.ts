import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { News } from '../news/news.entity';
import { StellarModule } from '../stellar/stellar.module';
import { VerificationModule } from '../verification/verification.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [StellarModule, VerificationModule, TypeOrmModule.forFeature([News])],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}

