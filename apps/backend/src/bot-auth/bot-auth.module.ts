import { Module } from '@nestjs/common';
import { BotAuthService } from './bot-auth.service';
import { BotCommandMapperService } from './bot-command-mapper.service';
import { AuditModule } from '../audit/audit.module';
import { BotPrincipalService } from './bot-principal.service';

@Module({
  imports: [AuditModule],
  providers: [BotAuthService, BotCommandMapperService, BotPrincipalService],
  exports: [BotAuthService, BotCommandMapperService, BotPrincipalService],
})
export class BotAuthModule {}
