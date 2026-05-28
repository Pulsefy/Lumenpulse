import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrowdfundController } from './crowdfund.controller';
import { CrowdfundService } from './crowdfund.service';
import { VaultEventIndexer } from './vault-event-indexer.service';
import { VaultDepositEvent } from './entities/vault-deposit-event.entity';
import { VaultMilestoneEvent } from './entities/vault-milestone-event.entity';
import { VaultIndexerCursor } from './entities/vault-indexer-cursor.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      VaultDepositEvent,
      VaultMilestoneEvent,
      VaultIndexerCursor,
    ]),
  ],
  controllers: [CrowdfundController],
  providers: [CrowdfundService, VaultEventIndexer],
  exports: [CrowdfundService],
})
export class CrowdfundModule {}
