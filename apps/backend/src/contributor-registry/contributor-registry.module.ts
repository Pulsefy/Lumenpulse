import { Module } from '@nestjs/common';
import { ContributorRegistryController } from './contributor-registry.controller';
import { ContributorRegistryService } from './contributor-registry.service';
import { StellarModule } from '../stellar/stellar.module';
import { AppCacheModule } from '../cache/cache.module';

@Module({
  imports: [StellarModule, AppCacheModule],
  controllers: [ContributorRegistryController],
  providers: [ContributorRegistryService],
})
export class ContributorRegistryModule {}
