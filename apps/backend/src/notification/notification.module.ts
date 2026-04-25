import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './notification.entity';
import { PushToken } from './push-token.entity';
import { NotificationPreference } from './notification-preference.entity';
import { NotificationDeliveryLog } from './notification-delivery-log.entity';
import { NotificationService } from './notification.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationPreferenceController } from './notification-preference.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Notification,
      PushToken,
      NotificationPreference,
      NotificationDeliveryLog,
    ]),
  ],
  providers: [
    NotificationService,
    NotificationPreferenceService,
    NotificationDeliveryService,
  ],
  exports: [
    NotificationService,
    NotificationPreferenceService,
    NotificationDeliveryService,
  ],
  controllers: [NotificationPreferenceController],
})
export class NotificationModule {}
