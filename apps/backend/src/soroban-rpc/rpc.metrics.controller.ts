import { Controller, Get } from '@nestjs/common';
import { RpcObservabilityService } from './rpc.observability.service';


@Controller('metrics')
export class RpcMetricsController {
  constructor(private readonly obs: RpcObservabilityService) {}

  @Get('rpc')
  getRpcMetrics(): { sorobanRpc: ReturnType<RpcObservabilityService['getSnapshot']> } {
    return { sorobanRpc: this.obs.getSnapshot() };
  }
}