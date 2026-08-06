import { Module } from '@nestjs/common';
import { GrantsController } from './grants.controller';
import { GrantsService } from './grants.service';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { SuspiciousContributionModule } from '../suspicious-contribution/suspicious-contribution.module';
import { SavedSearchModule } from '../saved-search/saved-search.module';

@Module({
  imports: [AdminAuditModule, SuspiciousContributionModule, SavedSearchModule],
  controllers: [GrantsController],
  providers: [GrantsService],
  exports: [GrantsService],
})
export class GrantsModule {}
