# Notification Preferences and Delivery Orchestration API

Backend support for managing per-user notification preferences and routing events to the correct delivery channels.

## Features

- **Per-User Preferences**: Each user can customize their notification settings
- **Multiple Delivery Channels**: In-app, Email, Push, Webhook, SMS
- **Event-Based Routing**: Different channels for different event types
- **Quiet Hours**: Suppress non-critical notifications during specified times
- **Daily Limits**: Cap the number of notifications per user per day
- **Severity Thresholds**: Only receive notifications above a certain severity
- **Delivery Tracking**: Log all delivery attempts with status
- **Retry Logic**: Automatically retry failed deliveries

## Architecture

```
Event Trigger
    ↓
Notification Created
    ↓
NotificationDeliveryService
    ↓
Get User Preferences
    ↓
Check Quiet Hours, Limits, Severity
    ↓
Route to Enabled Channels
    ↓
Delivery Log Created
```

## Database Schema

### Tables Created

1. **notification_preferences** - User notification settings
2. **notification_delivery_logs** - Delivery attempt tracking

### Entities

- `NotificationPreference` - Stores user preferences
- `NotificationDeliveryLog` - Tracks each delivery attempt
- `NotificationChannel` - Enum of delivery channels
- `NotificationEventCategory` - Enum of event types

## API Endpoints

### Notification Preferences

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/notification-preferences` | JWT | Create/update preferences |
| GET | `/notification-preferences` | JWT | Get current user preferences |
| GET | `/notification-preferences/:userId` | JWT/Admin | Get user preferences by ID |
| PUT | `/notification-preferences/:id` | JWT | Update preferences |
| DELETE | `/notification-preferences/:id` | JWT | Delete preferences |
| GET | `/notification-preferences/:userId/channels/:eventCategory` | JWT | Get enabled channels for event |

### Delivery Logs

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/notifications/:id/delivery-logs` | JWT | Get delivery logs for notification |
| GET | `/users/:userId/delivery-logs` | JWT | Get delivery logs for user |

## Quick Start

### 1. Create User Preferences

```typescript
POST /notification-preferences
{
  "userId": "user-uuid-here",
  "enabledChannels": ["in_app", "email", "push"],
  "eventPreferences": {
    "anomaly": {
      "enabled": true,
      "channels": ["in_app", "email"],
      "minSeverity": "medium"
    },
    "sentiment_spike": {
      "enabled": true,
      "channels": ["in_app", "push"]
    },
    "marketing": {
      "enabled": false,
      "channels": []
    }
  },
  "quietHours": {
    "startHour": 22,
    "endHour": 7,
    "timezone": "America/New_York",
    "allowCritical": true
  },
  "dailyLimit": 50,
  "minSeverity": "low"
}
```

### 2. Update Preferences

```typescript
PUT /notification-preferences/{id}
{
  "enabledChannels": ["in_app", "email"],
  "quietHours": {
    "startHour": 23,
    "endHour": 8,
    "timezone": "UTC",
    "allowCritical": true
  }
}
```

### 3. Get Enabled Channels for Event

```typescript
GET /notification-preferences/{userId}/channels/anomaly

Response:
["in_app", "email"]
```

## Delivery Orchestration

### Using the Service

```typescript
import { NotificationDeliveryService } from './notification-delivery.service';

@Injectable()
export class MyService {
  constructor(
    private readonly deliveryService: NotificationDeliveryService,
    private readonly notificationService: NotificationService,
  ) {}

  async sendNotification(userId: string, eventCategory: string) {
    // Create notification
    const notification = await this.notificationService.create({
      type: NotificationType.ANOMALY,
      title: 'Anomaly Detected',
      message: 'Unusual activity detected in your portfolio',
      severity: NotificationSeverity.HIGH,
      userId,
    });

    // Deliver to user based on their preferences
    const deliveryLogs = await this.deliveryService.deliverToUser(
      notification,
      userId,
      eventCategory,
    );

    return deliveryLogs;
  }
}
```

### Delivery Channels

#### In-App
- Notifications stored in database
- Retrieved via user's notification feed
- **Status**: ✅ Implemented

#### Email
- Requires email service integration (SendGrid, AWS SES, etc.)
- **Status**: 🔧 TODO - Integration needed

#### Push Notifications
- Requires FCM/APNs setup
- Uses `PushToken` entity for device tokens
- **Status**: 🔧 TODO - Integration needed

#### Webhook
- Send HTTP POST to user-configured webhook URL
- **Status**: 🔧 TODO - Implementation needed

#### SMS
- Requires SMS service (Twilio, etc.)
- **Status**: 🔧 TODO - Integration needed

## Configuration Options

### NotificationPreference

```typescript
interface NotificationPreference {
  userId: string;
  enabledChannels: NotificationChannel[];
  eventPreferences: Record<string, EventCategoryPreference>;
  quietHours: QuietHoursConfig | null;
  dailyLimit: number;          // 0 = unlimited
  minSeverity: string;         // 'low' | 'medium' | 'high' | 'critical'
}
```

### EventCategoryPreference

```typescript
interface EventCategoryPreference {
  enabled: boolean;
  channels: NotificationChannel[];
  minSeverity?: string;        // Override global severity
}
```

### QuietHoursConfig

```typescript
interface QuietHoursConfig {
  startHour: number;           // 0-23
  endHour: number;             // 0-23
  timezone: string;            // IANA timezone
  allowCritical: boolean;      // Allow critical during quiet hours
}
```

## Event Categories

Supported event categories:

- `anomaly` - Anomaly detection alerts
- `sentiment_spike` - Sentiment analysis spikes
- `system_alert` - System maintenance/alerts
- `price_threshold` - Price threshold alerts
- `portfolio_update` - Portfolio changes
- `security_alert` - Security notifications
- `marketing` - Marketing communications
- `all` - All events

## Delivery Status

- `pending` - Delivery attempted
- `sent` - Successfully sent to provider
- `delivered` - Confirmed delivered to user
- `failed` - Delivery failed
- `skipped` - Skipped due to preferences

## Filtering Logic

When a notification is triggered, the system checks:

1. **Quiet Hours**: Skip if within quiet hours (unless critical and allowed)
2. **Severity Threshold**: Skip if below minimum severity
3. **Daily Limit**: Skip if user has reached daily limit
4. **Event Category**: Skip if event category is disabled
5. **Channel Availability**: Only deliver to enabled channels

## Delivery Log Queries

### Get Logs for Notification

```typescript
const logs = await deliveryService.getDeliveryLogsForNotification(
  'notification-uuid'
);
```

### Get Logs for User

```typescript
const logs = await deliveryService.getDeliveryLogsForUser(
  'user-uuid',
  50  // limit
);
```

### Retry Failed Deliveries

```typescript
const retried = await deliveryService.retryFailedDeliveries(3);
console.log(`Retried ${retried} failed deliveries`);
```

## Integration with Webhooks

When a webhook event is received:

```typescript
// In webhook handler
const notification = await this.notificationService.create({
  type: NotificationType.ANOMALY,
  title: 'Anomaly Detected',
  message: '...',
  severity: NotificationSeverity.HIGH,
  userId: null,  // Broadcast
});

// For broadcast notifications, deliver to relevant users
const users = await this.getRelevantUsers(notification);
for (const user of users) {
  await this.deliveryService.deliverToUser(
    notification,
    user.id,
    'anomaly'
  );
}
```

## Examples

### Example 1: User wants only critical anomalies via email

```typescript
POST /notification-preferences
{
  "userId": "user-123",
  "enabledChannels": ["in_app"],
  "eventPreferences": {
    "anomaly": {
      "enabled": true,
      "channels": ["email"],
      "minSeverity": "critical"
    }
  }
}
```

### Example 2: User wants all notifications except during sleep

```typescript
POST /notification-preferences
{
  "userId": "user-456",
  "enabledChannels": ["in_app", "email", "push"],
  "quietHours": {
    "startHour": 23,
    "endHour": 7,
    "timezone": "America/Los_Angeles",
    "allowCritical": true
  },
  "dailyLimit": 100,
  "minSeverity": "low"
}
```

### Example 3: Disable marketing notifications

```typescript
POST /notification-preferences
{
  "userId": "user-789",
  "enabledChannels": ["in_app", "email"],
  "eventPreferences": {
    "marketing": {
      "enabled": false,
      "channels": []
    }
  }
}
```

## Monitoring and Analytics

Track delivery metrics:

```typescript
// Success rate
const totalDeliveries = await deliveryLogRepository.count();
const successfulDeliveries = await deliveryLogRepository.count({
  where: { status: In(DeliveryStatus.DELIVERED, DeliveryStatus.SENT) }
});
const successRate = (successfulDeliveries / totalDeliveries) * 100;

// Channel performance
const channelStats = await deliveryLogRepository
  .createQueryBuilder('log')
  .select('log.channel', 'channel')
  .addSelect('COUNT(*)', 'total')
  .addSelect('SUM(CASE WHEN log.status = \'delivered\' THEN 1 ELSE 0 END)', 'delivered')
  .groupBy('log.channel')
  .getRawMany();
```

## Testing

```bash
# Create preferences
curl -X POST http://localhost:3000/notification-preferences \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-uuid",
    "enabledChannels": ["in_app", "email"],
    "minSeverity": "medium"
  }'

# Get preferences
curl http://localhost:3000/notification-preferences \
  -H "Authorization: Bearer <token>"
```

## Future Enhancements

- [ ] Email delivery integration (SendGrid/AWS SES)
- [ ] Push notification integration (FCM/APNs)
- [ ] SMS delivery integration (Twilio)
- [ ] Webhook delivery to user-configured endpoints
- [ ] Notification batching and digest emails
- [ ] A/B testing for notification timing
- [ ] Machine learning for optimal delivery times
- [ ] User notification inbox with read/unread status
- [ ] Real-time notifications via WebSockets
