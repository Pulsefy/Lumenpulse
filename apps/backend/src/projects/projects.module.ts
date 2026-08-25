import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectRegistryEntity } from '../database/entities/project-registry.entity';
import { AppCacheModule } from '../cache/cache.module';
import { StellarModule } from '../stellar/stellar.module';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProjectRegistryEntity]),
    AppCacheModule,
    StellarModule,
    MetricsModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
