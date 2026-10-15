import { Module } from '@nestjs/common';
import { BootstrapRunsModule } from '../bootstrap-runs/bootstrap-runs.module';
import { BootstrapTeardownService } from './bootstrap-teardown.service';
import { DemoBootstrapController } from './demo-bootstrap.controller';
import { DemoBootstrapService } from './demo-bootstrap.service';

@Module({
  imports: [BootstrapRunsModule],
  controllers: [DemoBootstrapController],
  providers: [DemoBootstrapService, BootstrapTeardownService],
  exports: [DemoBootstrapService, BootstrapTeardownService],
})
export class DemoBootstrapModule {}
