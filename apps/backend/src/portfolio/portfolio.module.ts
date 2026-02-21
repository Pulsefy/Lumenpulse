// src/portfolio/portfolio.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PortfolioAsset } from './portfolio-asset.entity';
import { PortfolioSnapshot } from './entities/portfolio-snapshot.entity';
import { User } from '../users/entities/user.entity';
import { PortfolioService } from './portfolio.service';
import { PortfolioController } from './portfolio.controller';
import { StellarBalanceService } from './stellar-balance.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PortfolioAsset, PortfolioSnapshot, User]),
  ],
  controllers: [PortfolioController],
  providers: [PortfolioService, StellarBalanceService],
  exports: [PortfolioService, TypeOrmModule],
})
export class PortfolioModule {}
