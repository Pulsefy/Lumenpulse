import { Module } from '@nestjs/common';
import { DemoBootstrapController } from './demo-bootstrap.controller';
import { DemoBootstrapService } from './demo-bootstrap.service';

@Module({
  controllers: [DemoBootstrapController],
  providers: [DemoBootstrapService],
  exports: [DemoBootstrapService],
})
export class DemoBootstrapModule {}
