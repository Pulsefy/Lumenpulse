import { Module } from '@nestjs/common';
import { BotAuthService } from './bot-auth.service';
import { BotCommandMapperService } from './bot-command-mapper.service';

@Module({
  providers: [BotAuthService, BotCommandMapperService],
  exports: [BotAuthService, BotCommandMapperService],
})
export class BotAuthModule {}
