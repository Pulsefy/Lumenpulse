import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { News } from '../news/news.entity';
import { StellarModule } from '../stellar/stellar.module';
import { VerificationModule } from '../verification/verification.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { SavedSearchesModule } from './saved-searches/saved-searches.module';

@Module({
  imports: [
    StellarModule,
    VerificationModule,
    TypeOrmModule.forFeature([News]),
    SavedSearchesModule,
  ],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
