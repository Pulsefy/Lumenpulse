import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExportJob } from './entities/export-job.entity';
import { ExportService } from './export.service';
import { ExportController } from './export.controller';
import { PortfolioSnapshot } from '../portfolio/entities/portfolio-snapshot.entity';
import { TransactionModule } from '../transaction/transaction.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ExportJob, PortfolioSnapshot]),
    TransactionModule,
  ],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
