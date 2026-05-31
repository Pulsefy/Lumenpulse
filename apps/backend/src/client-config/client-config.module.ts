import { Module } from '@nestjs/common';
import { ClientConfigController } from './client-config.controller';
import { ClientConfigService } from './client-config.service';

@Module({
  controllers: [ClientConfigController],
  providers: [ClientConfigService],
  exports: [ClientConfigService],
})
export class ClientConfigModule {}
