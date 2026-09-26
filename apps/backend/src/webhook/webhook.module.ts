import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { WebhookVerificationService } from './webhook-verification.service';
import { WebhookVerificationGuard } from './webhook-verification.guard';
import { WebhookAdminController } from './webhook-admin.controller';
import { NotificationModule } from '../notification/notification.module';
import { MetricsModule } from '../metrics/metrics.module';
import { MessageTemplateModule } from '../message-template/message-template.module';

@Module({
  imports: [NotificationModule, MetricsModule, MessageTemplateModule],
  controllers: [WebhookController, WebhookAdminController],
  providers: [
    WebhookService,
    WebhookVerificationService,
    WebhookVerificationGuard,
  ],
  exports: [
    WebhookService,
    WebhookVerificationService,
    WebhookVerificationGuard,
  ],
})
export class WebhookModule {}
