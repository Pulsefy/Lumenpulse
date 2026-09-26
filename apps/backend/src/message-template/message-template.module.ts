import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessageTemplate } from './message-template.entity';
import { MessageTemplateAuditLog } from './message-template-audit-log.entity';
import { MessageTemplateService } from './message-template.service';
import { MessageTemplateController } from './message-template.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([MessageTemplate, MessageTemplateAuditLog]),
  ],
  providers: [MessageTemplateService],
  controllers: [MessageTemplateController],
  exports: [MessageTemplateService],
})
export class MessageTemplateModule {}
