import { Module } from '@nestjs/common';
import { AppCacheModule } from '../cache/cache.module';
import { StellarModule } from '../stellar/stellar.module';
import { ContributorRegistryController } from './contributor-registry.controller';
import { ContributorRegistryService } from './contributor-registry.service';
import { ContractAdminModule } from '../contract-admin/contract-admin.module';

@Module({
  imports: [AppCacheModule, StellarModule, ContractAdminModule],
  controllers: [ContributorRegistryController],
  providers: [ContributorRegistryService],
  exports: [ContributorRegistryService],
})
export class ContributorRegistryModule {}
