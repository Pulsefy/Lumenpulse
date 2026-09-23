import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PortfolioMaterializedSnapshot } from './entities/portfolio-materialized-snapshot.entity';
import { PortfolioSnapshot } from './entities/portfolio-snapshot.entity';
import { StellarAccount } from '../users/entities/stellar-account.entity';
import { MaterializedSnapshotService } from './materialized-snapshot.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PortfolioMaterializedSnapshot,
      PortfolioSnapshot,
      StellarAccount,
    ]),
  ],
  providers: [MaterializedSnapshotService],
  exports: [MaterializedSnapshotService],
})
export class MaterializedSnapshotModule {}
