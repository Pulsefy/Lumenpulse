import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { WebhookVerificationService } from './webhook-verification.service';
import { WebhookVerificationGuard } from './webhook-verification.guard';
import { WebhookAdminController } from './webhook-admin.controller';
import { NotificationModule } from '../notification/notification.module';
import { MetricsModule } from '../metrics/metrics.module';
import { MessageTemplateModule } from '../message-template/message-template.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { AuditModule } from '../audit/audit.module';
import { OutboxModule } from '../outbox/outbox.module';
import { WebhookSubscription } from './outbound/entities/webhook-subscription.entity';
import { WebhookDelivery } from './outbound/entities/webhook-delivery.entity';
import { WebhookDeadLetter } from './outbound/entities/webhook-dead-letter.entity';
import { OutboundWebhookService } from './outbound/outbound-webhook.service';
import { WebhookSubscriptionController } from './outbound/webhook-subscription.controller';
import { WebhookDeadLetterController } from './outbound/webhook-dead-letter.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WebhookSubscription,
      WebhookDelivery,
      WebhookDeadLetter,
    ]),
    HttpModule,
    NotificationModule,
    MetricsModule,
    MessageTemplateModule,
    SchedulerModule,
    AuditModule,
    OutboxModule,
  ],
  controllers: [
    WebhookController,
    WebhookAdminController,
    WebhookSubscriptionController,
    WebhookDeadLetterController,
  ],
  providers: [
    WebhookService,
    WebhookVerificationService,
    WebhookVerificationGuard,
    OutboundWebhookService,
  ],
  exports: [
    WebhookService,
    WebhookVerificationService,
    WebhookVerificationGuard,
    OutboundWebhookService,
  ],
})
export class WebhookModule {}
