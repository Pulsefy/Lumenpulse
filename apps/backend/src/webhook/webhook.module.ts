import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { WebhookVerificationService } from './webhook-verification.service';
import { WebhookVerificationGuard } from './webhook-verification.guard';
import { WebhookAdminController } from './webhook-admin.controller';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [WebhookController, WebhookAdminController],
  providers: [
    WebhookService,
    WebhookVerificationService,
    WebhookVerificationGuard,
  ],
  exports: [WebhookVerificationService, WebhookVerificationGuard],
})
export class WebhookModule {}
