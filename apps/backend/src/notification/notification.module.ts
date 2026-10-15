import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './notification.entity';
import { PushToken } from './push-token.entity';
import { NotificationPreference } from './notification-preference.entity';
import { NotificationDeliveryLog } from './notification-delivery-log.entity';
import { NotificationSuppressionLog } from './notification-suppression-log.entity';
import { WatchlistItem } from '../watchlist/watchlist-item.entity';
import { NotificationService } from './notification.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationFanoutService } from './notification-fanout.service';
import { DriftAlertIngestionService } from './drift-alert-ingestion.service';
import { PushTokenService } from './push-token.service';
import { PushTokenController } from './push-token.controller';
import { NotificationPreferenceController } from './notification-preference.controller';
import { NotificationFanoutController } from './notification-fanout.controller';
import { DriftAlertIngestionController } from './drift-alert-ingestion.controller';
import { ProfilingModule } from '../common/profiling/profiling.module';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Notification,
      PushToken,
      NotificationPreference,
      NotificationDeliveryLog,
      NotificationSuppressionLog,
      WatchlistItem,
    ]),
    ProfilingModule,
    MetricsModule,
  ],
  providers: [
    NotificationService,
    NotificationPreferenceService,
    NotificationDeliveryService,
    NotificationFanoutService,
    DriftAlertIngestionService,
    PushTokenService,
  ],
  exports: [
    NotificationService,
    NotificationPreferenceService,
    NotificationDeliveryService,
    NotificationFanoutService,
    PushTokenService,
  ],
  controllers: [
    NotificationPreferenceController,
    NotificationFanoutController,
    DriftAlertIngestionController,
    PushTokenController,
  ],
})
export class NotificationModule {}
