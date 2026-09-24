import { Module } from '@nestjs/common';
import { BotAuthService } from './bot-auth.service';
import { BotCommandMapperService } from './bot-command-mapper.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [BotAuthService, BotCommandMapperService],
  exports: [BotAuthService, BotCommandMapperService],
})
export class BotAuthModule {}
