import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { ContractCapabilityService } from './contract-capability.service';
import { AppConfigModule } from '../config/config.module';

@Module({
  imports: [AppConfigModule],
  controllers: [ContractsController],
  providers: [ContractCapabilityService],
  exports: [ContractCapabilityService],
})
export class ContractsModule {}
