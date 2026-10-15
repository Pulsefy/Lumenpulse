import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BootstrapRunRegistryService } from './bootstrap-run-registry.service';
import { BootstrapRun } from './entities/bootstrap-run.entity';

/**
 * Shared registry of bootstrap runs.
 *
 * Imported by every module that creates bootstrap state (demo seeding,
 * Friendbot funding) as well as by the teardown path, so all of them agree on
 * a single record of what a run produced.
 */
@Module({
  imports: [TypeOrmModule.forFeature([BootstrapRun])],
  providers: [BootstrapRunRegistryService],
  exports: [BootstrapRunRegistryService],
})
export class BootstrapRunsModule {}
