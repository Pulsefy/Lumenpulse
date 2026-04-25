# Implementation Guide: Webhook Verification + Notification Preferences

This guide shows how to integrate the webhook signature verification framework with the notification preferences and delivery orchestration system.

## Overview

The two systems work together to:
1. **Receive** signed webhook events from trusted providers
2. **Verify** the authenticity of those events
3. **Create** notifications based on the events
4. **Route** notifications to users based on their preferences
5. **Deliver** via the appropriate channels (in-app, email, push, etc.)

## Complete Flow Example

### Step 1: Configure Webhook Provider

```bash
# .env
WEBHOOK_PROVIDERS='[
  {
    "name": "data-processing",
    "algorithm": "hmac-sha256",
    "secret": "your-secret-key-here",
    "enabled": true
  }
]'
```

### Step 2: Set Up User Preferences

Users configure how they want to receive notifications:

```typescript
// User sets their preferences
POST /notification-preferences
{
  "userId": "user-uuid-123",
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
    }
  },
  "quietHours": {
    "startHour": 22,
    "endHour": 7,
    "timezone": "America/New_York",
    "allowCritical": true
  },
  "dailyLimit": 50
}
```

### Step 3: Webhook Provider Sends Event

The data-processing service sends a signed webhook:

```python
# Python data-processing service
import hmac
import hashlib
import requests
import json

def send_webhook(payload: dict, secret: str):
    # Generate signature
    payload_json = json.dumps(payload)
    signature = hmac.new(
        secret.encode('utf-8'),
        payload_json.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    
    # Send request
    response = requests.post(
        'https://api.lumenpulse.com/webhooks/data-processing',
        headers={
            'Content-Type': 'application/json',
            'X-Webhook-Signature': f'sha256={signature}'
        },
        data=payload_json
    )
    
    return response

# Example payload
payload = {
    "event": "high_priority_insight",
    "type": "anomaly",
    "metric_name": "trading_volume",
    "severity_score": 0.85,
    "current_value": 1234567.89,
    "baseline_mean": 800000.0,
    "baseline_std": 120000.0,
    "z_score": 3.6,
    "timestamp": "2026-04-25T14:30:00.000Z"
}

send_webhook(payload, "your-secret-key-here")
```

### Step 4: Backend Receives and Verifies

The webhook is automatically verified by the guard:

```typescript
// webhook.controller.ts
@Post('data-processing')
@HttpCode(HttpStatus.OK)
@UseGuards(WebhookVerificationGuard)
@WebhookProvider('data-processing')
async handleDataProcessing(
  @Req() req: Request,
  @Body() payload: DataProcessingWebhookDto,
): Promise<{ status: string; notificationId: string }> {
  // ✅ Signature already verified by guard
  // ✅ If we reach here, signature is valid
  
  const notification =
    await this.webhookService.handleDataProcessingEvent(payload);
  
  return { status: 'ok', notificationId: notification.id };
}
```

### Step 5: Create Notification and Deliver

Enhanced webhook service with delivery orchestration:

```typescript
// webhook.service.ts (enhanced version)
@Injectable()
export class WebhookService {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly deliveryService: NotificationDeliveryService,
    private readonly usersService: UsersService,
    private readonly watchlistService: WatchlistService,
  ) {}

  async handleDataProcessingEvent(
    payload: DataProcessingWebhookDto,
  ): Promise<Notification> {
    // 1. Create the notification
    const notification = await this.notificationService.create({
      type: payload.type === 'sentiment_spike'
        ? NotificationType.SENTIMENT_SPIKE
        : NotificationType.ANOMALY,
      title: this.buildTitle(payload),
      message: this.buildMessage(payload),
      severity: this.resolveSeverity(payload.severity_score),
      metadata: payload,
      userId: null, // Broadcast notification
    });

    // 2. Find users who should receive this notification
    const usersToNotify = await this.findRelevantUsers(payload);

    // 3. Deliver to each user based on their preferences
    for (const user of usersToNotify) {
      try {
        await this.deliveryService.deliverToUser(
          notification,
          user.id,
          payload.type, // event category
        );
      } catch (error) {
        this.logger.error(
          `Failed to deliver notification ${notification.id} to user ${user.id}`,
          error,
        );
      }
    }

    return notification;
  }

  private async findRelevantUsers(
    payload: DataProcessingWebhookDto,
  ): Promise<User[]> {
    // Get users who have this asset in their watchlist
    const watchlistUsers = await this.watchlistService.getUsersByAsset(
      payload.metric_name,
    );

    // Get users who have this asset in their portfolio
    const portfolioUsers = await this.usersService.getUsersWithAsset(
      payload.metric_name,
    );

    // Combine and deduplicate
    const userIds = new Set([
      ...watchlistUsers.map(u => u.id),
      ...portfolioUsers.map(u => u.id),
    ]);

    return Array.from(userIds).map(id => ({ id } as User));
  }
}
```

## Advanced Usage

### Custom Webhook Provider with RSA

```typescript
// Register RSA provider at runtime
POST /webhooks/admin/providers
{
  "name": "partner-api",
  "algorithm": "rsa-sha256",
  "publicKey": "LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0...",
  "enabled": true,
  "timestampToleranceMs": 300000,
  "signatureHeader": "X-Partner-Signature",
  "timestampHeader": "X-Partner-Timestamp"
}
```

```typescript
// Use the provider
@Post('partner')
@UseGuards(WebhookVerificationGuard)
@WebhookProvider('partner-api')
async handlePartnerWebhook(
  @Req() req: Request,
  @Body() payload: PartnerPayloadDto,
) {
  // Verified with RSA
  return { status: 'ok' };
}
```

### Dynamic Event Routing

```typescript
@Injectable()
export class SmartNotificationService {
  async routeEvent(event: WebhookEvent) {
    // Determine event category
    const category = this.categorizeEvent(event);
    
    // Find interested users
    const users = await this.findInterestedUsers(event, category);
    
    // Create notification
    const notification = await this.notificationService.create({
      type: this.mapEventType(event.type),
      title: event.title,
      message: event.message,
      severity: event.severity,
      metadata: event.data,
    });
    
    // Deliver with intelligent routing
    const deliveryPromises = users.map(async (user) => {
      // Check if user wants this type of notification
      const channels = await this.preferenceService.getEnabledChannelsForEvent(
        user.id,
        category,
      );
      
      if (channels.length > 0) {
        return this.deliveryService.deliverToUser(
          notification,
          user.id,
          category,
        );
      }
    });
    
    return Promise.all(deliveryPromises);
  }
}
```

### Batch Delivery for Efficiency

```typescript
@Injectable()
export class BatchNotificationService {
  async deliverBatch(
    notification: Notification,
    userIds: string[],
    eventCategory: string,
  ) {
    const batchSize = 100;
    const results = [];
    
    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);
      
      const batchResults = await Promise.all(
        batch.map(async (userId) => {
          try {
            return await this.deliveryService.deliverToUser(
              notification,
              userId,
              eventCategory,
            );
          } catch (error) {
            this.logger.error(`Failed to deliver to ${userId}`, error);
            return null;
          }
        }),
      );
      
      results.push(...batchResults.filter(Boolean));
      
      // Small delay to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return results;
  }
}
```

## Monitoring and Observability

### Track Delivery Metrics

```typescript
@Injectable()
export class NotificationMetricsService {
  constructor(
    @InjectRepository(NotificationDeliveryLog)
    private readonly deliveryLogRepository: Repository<NotificationDeliveryLog>,
  ) {}

  async getDeliveryMetrics(): Promise<DeliveryMetrics> {
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const totalDeliveries = await this.deliveryLogRepository.count({
      where: { createdAt: MoreThan(last24Hours) },
    });
    
    const successfulDeliveries = await this.deliveryLogRepository.count({
      where: {
        createdAt: MoreThan(last24Hours),
        status: In([DeliveryStatus.DELIVERED, DeliveryStatus.SENT]),
      },
    });
    
    const failedDeliveries = await this.deliveryLogRepository.count({
      where: {
        createdAt: MoreThan(last24Hours),
        status: DeliveryStatus.FAILED,
      },
    });
    
    return {
      totalDeliveries,
      successfulDeliveries,
      failedDeliveries,
      successRate: (successfulDeliveries / totalDeliveries) * 100,
    };
  }

  async getChannelPerformance(): Promise<ChannelStats[]> {
    return this.deliveryLogRepository
      .createQueryBuilder('log')
      .select('log.channel', 'channel')
      .addSelect('COUNT(*)', 'total')
      .addSelect(
        'SUM(CASE WHEN log.status IN (:...success) THEN 1 ELSE 0 END)',
        'successful',
      )
      .setParameters({ success: [DeliveryStatus.DELIVERED, DeliveryStatus.SENT] })
      .groupBy('log.channel')
      .getRawMany();
  }
}
```

### Alert on Delivery Failures

```typescript
@Injectable()
export class DeliveryAlertService {
  @Cron('*/5 * * * *') // Every 5 minutes
  async checkForDeliveryIssues() {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    const recentFailures = await this.deliveryLogRepository.count({
      where: {
        status: DeliveryStatus.FAILED,
        createdAt: MoreThan(fiveMinutesAgo),
      },
    });
    
    if (recentFailures > 100) {
      // Send alert to admins
      await this.alertService.sendAlert({
        type: 'high_failure_rate',
        message: `${recentFailures} delivery failures in last 5 minutes`,
        severity: 'critical',
      });
    }
  }
}
```

## Testing the Integration

### Manual Testing

```bash
# 1. Set up user preferences
curl -X POST http://localhost:3000/notification-preferences \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-123",
    "enabledChannels": ["in_app", "email"],
    "eventPreferences": {
      "anomaly": {
        "enabled": true,
        "channels": ["in_app", "email"],
        "minSeverity": "low"
      }
    }
  }'

# 2. Generate webhook signature
PAYLOAD='{"event":"high_priority_insight","type":"anomaly","metric_name":"volume","severity_score":0.85,"current_value":1234567,"baseline_mean":800000,"baseline_std":120000,"z_score":3.6}'
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "your-secret-key" | awk '{print $2}')

# 3. Send webhook
curl -X POST http://localhost:3000/webhooks/data-processing \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: sha256=$SIGNATURE" \
  -d "$PAYLOAD"

# 4. Check delivery logs
curl http://localhost:3000/users/user-123/delivery-logs \
  -H "Authorization: Bearer $TOKEN"
```

### Automated Testing

```typescript
describe('Webhook + Notification Integration', () => {
  it('should verify webhook and deliver notification', async () => {
    // 1. Create user preferences
    const preferences = await preferenceService.createOrUpdate({
      userId: 'test-user',
      enabledChannels: ['in_app'],
      eventPreferences: {
        anomaly: { enabled: true, channels: ['in_app'] },
      },
    });

    // 2. Create signed webhook
    const payload = {
      event: 'high_priority_insight',
      type: 'anomaly',
      metric_name: 'volume',
      severity_score: 0.85,
      current_value: 1234567,
      baseline_mean: 800000,
      baseline_std: 120000,
      z_score: 3.6,
    };

    const signature = generateHmacSignature(payload, 'test-secret');

    // 3. Send webhook
    const response = await request(app.getHttpServer())
      .post('/webhooks/data-processing')
      .set('X-Webhook-Signature', signature)
      .send(payload)
      .expect(200);

    // 4. Verify notification created
    expect(response.body.notificationId).toBeDefined();

    // 5. Verify delivery logs created
    const logs = await deliveryLogRepository.find({
      where: { notificationId: response.body.notificationId },
    });
    expect(logs.length).toBeGreaterThan(0);
  });
});
```

## Best Practices

1. **Always verify webhook signatures** - Use the guard, don't skip verification
2. **Respect user preferences** - Don't bypass preference settings
3. **Monitor delivery rates** - Track success/failure metrics
4. **Implement retry logic** - Transient failures happen
5. **Use batch processing** - For large numbers of users
6. **Log everything** - Delivery logs are crucial for debugging
7. **Test with real signatures** - Don't disable verification in testing
8. **Rotate secrets** - Regularly update webhook secrets
9. **Rate limit webhook endpoints** - Prevent abuse
10. **Document your webhook contracts** - Clear API documentation

## Troubleshooting

### Webhook Verification Fails

```typescript
// Check logs for:
// - "Webhook verification failed for provider X: Y"
// - Common issues:
//   - Wrong secret key
//   - Incorrect signature format
//   - Timestamp expired
//   - IP not whitelisted
```

### Notifications Not Delivered

```typescript
// Check:
// 1. User preferences exist
// 2. Event category is enabled
// 3. Severity meets threshold
// 4. Not within quiet hours
// 5. Daily limit not reached
// 6. Delivery logs for error messages
```

### Performance Issues

```typescript
// Solutions:
// 1. Use batch delivery
// 2. Implement message queue (Redis, RabbitMQ)
// 3. Add caching for user preferences
// 4. Use connection pooling
// 5. Monitor database query performance
```
