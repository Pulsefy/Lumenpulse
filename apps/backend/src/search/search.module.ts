import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { News } from '../news/news.entity';
import { StellarModule } from '../stellar/stellar.module';
import { VerificationModule } from '../verification/verification.module';
import { EntityAliasModule } from '../entity-alias/entity-alias.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [
    StellarModule,
    VerificationModule,
    EntityAliasModule,
    TypeOrmModule.forFeature([News]),
  ],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
