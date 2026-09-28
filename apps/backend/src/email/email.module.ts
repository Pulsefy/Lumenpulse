import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { ConfigModule } from '@nestjs/config';
import { MessageTemplateModule } from '../message-template/message-template.module';

@Module({
  imports: [ConfigModule, MessageTemplateModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
