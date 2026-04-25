import { Global, Module } from '@nestjs/common';
import { CorrelationService } from './correlation.service';

@Global()
@Module({
  providers: [CorrelationService],
  exports: [CorrelationService],
})
export class CorrelationModule {}
