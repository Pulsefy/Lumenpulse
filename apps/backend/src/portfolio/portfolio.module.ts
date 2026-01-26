// src/portfolio/portfolio.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PortfolioAsset } from './portfolio-asset.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PortfolioAsset])],
  controllers: [], // no controllers yet
  providers: [],   // no services yet
  exports: [TypeOrmModule], // optional, in case other modules need access
})
export class PortfolioModule {}
