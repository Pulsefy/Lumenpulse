# Webhook & Notification Features - Quick Start Guide

This guide helps you get started with the newly implemented webhook signature verification framework and notification preferences system.

## 📋 What Was Implemented

### 1. Inbound Webhook Signature Verification Framework
- Multi-provider webhook signature verification
- Support for HMAC-SHA256, HMAC-SHA512, RSA-SHA256, Ed25519
- Runtime provider management
- Guard-based verification

### 2. Notification Preferences & Delivery Orchestration
- Per-user notification preferences
- Multi-channel delivery (in-app, email, push, webhook, SMS)
- Event-based routing
- Quiet hours, daily limits, severity thresholds
- Delivery tracking and retry logic

## 🚀 Quick Start (5 Minutes)

### Step 1: Run Database Migration

```bash
# PostgreSQL
psql -U your_user -d your_database -f apps/backend/src/migrations/add-notification-preferences-and-delivery-logs.sql
```

### Step 2: Configure Environment

Add to `apps/backend/.env`:

```bash
# Webhook Configuration
WEBHOOK_PROVIDERS='[
  {
    "name": "data-processing",
    "algorithm": "hmac-sha256",
    "secret": "your-secret-key-here",
    "enabled": true
  }
]'

# Notification Configuration
NOTIFICATION_DEFAULT_CHANNELS=in_app
NOTIFICATION_DEFAULT_DAILY_LIMIT=100
```

### Step 3: Start the Server

```bash
cd apps/backend
npm install
npm run start:dev
```

### Step 4: Test the Features

#### Test Webhook Verification

```bash
# Generate signature
PAYLOAD='{"event":"high_priority_insight","type":"anomaly","metric_name":"volume","severity_score":0.85,"current_value":1234567,"baseline_mean":800000,"baseline_std":120000,"z_score":3.6}'
SECRET="your-secret-key-here"
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

# Send webhook
curl -X POST http://localhost:3000/webhooks/data-processing \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: sha256=$SIGNATURE" \
  -d "$PAYLOAD"
```

Expected response: `{"status":"ok","notificationId":"uuid-here"}`

#### Test Notification Preferences

```bash
# Login to get JWT token
TOKEN=$(curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"your-password"}' \
  | jq -r '.accessToken')

# Create preferences
curl -X POST http://localhost:3000/notification-preferences \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "your-user-id",
    "enabledChannels": ["in_app", "email"],
    "eventPreferences": {
      "anomaly": {
        "enabled": true,
        "channels": ["in_app", "email"],
        "minSeverity": "medium"
      }
    },
    "quietHours": {
      "startHour": 22,
      "endHour": 7,
      "timezone": "America/New_York",
      "allowCritical": true
    },
    "dailyLimit": 50
  }'

# Get preferences
curl http://localhost:3000/notification-preferences/your-user-id \
  -H "Authorization: Bearer $TOKEN"
```

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [WEBHOOK_VERIFICATION_FRAMEWORK.md](./WEBHOOK_VERIFICATION_FRAMEWORK.md) | Complete webhook framework docs |
| [NOTIFICATION_PREFERENCES_API.md](./NOTIFICATION_PREFERENCES_API.md) | Notification system docs |
| [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md) | How to use both systems together |
| [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) | Implementation overview |

## 🏗️ Architecture

### Webhook Flow

```
External Service
    ↓ Sends signed webhook
Webhook Endpoint
    ↓
WebhookVerificationGuard
    ↓ Verifies signature using provider config
WebhookVerificationService
    ↓
Webhook Controller
    ↓
Webhook Service
    ↓ Creates notification
Notification Service
    ↓
Delivery Service
    ↓ Routes based on user preferences
Notification Channels
```

### Notification Flow

```
Event Triggered
    ↓
Notification Created
    ↓
Get User Preferences
    ↓
Check Filters (quiet hours, limits, severity)
    ↓
Route to Enabled Channels
    ↓
Deliver & Log
```

## 🎯 Common Use Cases

### Use Case 1: Add New Webhook Provider

```typescript
// Via API
POST /webhooks/admin/providers
{
  "name": "my-partner",
  "algorithm": "hmac-sha256",
  "secret": "shared-secret",
  "enabled": true
}

// Use in controller
@Post('partner')
@UseGuards(WebhookVerificationGuard)
@WebhookProvider('my-partner')
async handlePartnerWebhook(@Body() payload: any) {
  return { status: 'ok' };
}
```

### Use Case 2: User Wants Email Notifications Only for Critical Anomalies

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

### Use Case 3: Disable Notifications During Sleep

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
  }
}
```

## 🔧 Development

### Project Structure

```
apps/backend/src/
├── webhook/
│   ├── webhook-verification.service.ts    # Core verification
│   ├── webhook-verification.guard.ts      # NestJS guard
│   ├── webhook-admin.controller.ts        # Admin API
│   ├── webhook.controller.ts              # Webhook endpoints
│   ├── webhook.service.ts                 # Webhook processing
│   ├── webhook.types.ts                   # Type definitions
│   ├── webhook.module.ts                  # Module definition
│   └── dto/
│       ├── webhook-provider.dto.ts        # Provider DTOs
│       └── webhook-payload.dto.ts         # Payload DTOs
│
└── notification/
    ├── notification-preference.entity.ts  # Preferences entity
    ├── notification-delivery-log.entity.ts # Delivery logs
    ├── notification-preference.service.ts # Preferences service
    ├── notification-delivery.service.ts   # Delivery orchestration
    ├── notification-preference.controller.ts # Preferences API
    ├── notification.service.ts            # Notification CRUD
    ├── notification.module.ts             # Module definition
    └── dto/
        └── notification-preference.dto.ts # Preference DTOs
```

### Adding New Features

#### Add New Signature Algorithm

1. Add to `WebhookSignatureAlgorithm` enum in `webhook.types.ts`
2. Implement verification method in `webhook-verification.service.ts`
3. Add case to `verifySignature()` switch statement
4. Update documentation

#### Add New Delivery Channel

1. Add to `NotificationChannel` enum in `notification-preference.entity.ts`
2. Implement delivery method in `notification-delivery.service.ts`
3. Add case to `deliverToChannel()` switch statement
4. Update documentation

## 🧪 Testing

### Run Tests

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Test with coverage
npm run test:cov
```

### Manual Testing Checklist

- [ ] Webhook signature verification works
- [ ] Invalid signatures are rejected
- [ ] User preferences can be created
- [ ] User preferences can be updated
- [ ] Notifications are delivered to correct channels
- [ ] Quiet hours are respected
- [ ] Daily limits are enforced
- [ ] Severity thresholds work
- [ ] Delivery logs are created
- [ ] Admin API for providers works

## 🐛 Troubleshooting

### Webhook Verification Fails

**Problem**: `401 Unauthorized - Webhook signature mismatch`

**Solutions**:
1. Check that the secret matches on both sides
2. Verify signature format: `sha256=<hex>`
3. Check logs for detailed error messages
4. Test with a simple payload first

### Notifications Not Delivered

**Problem**: Notification created but not delivered

**Solutions**:
1. Check user preferences exist
2. Verify event category is enabled
3. Check severity threshold
4. Verify not within quiet hours
5. Check daily limit not reached
6. Review delivery logs for errors

### Database Migration Fails

**Problem**: Migration SQL fails

**Solutions**:
1. Check PostgreSQL version (needs 9.4+ for JSONB)
2. Verify database permissions
3. Check if tables already exist
4. Run migration in transaction

## 📊 Monitoring

### Important Metrics

- Webhook verification success rate
- Notification delivery success rate
- Average delivery time
- Channel performance
- User preference adoption
- Failed delivery count

### Log Locations

```bash
# Webhook verification logs
grep "WebhookVerificationGuard" logs/app.log

# Delivery logs
grep "NotificationDeliveryService" logs/app.log

# Failed deliveries
grep "FAILED" logs/app.log
```

## 🔐 Security Best Practices

1. **Always use HTTPS** for webhook endpoints
2. **Rotate secrets** regularly (every 90 days)
3. **Enable timestamp validation** to prevent replay attacks
4. **Use IP whitelisting** when possible
5. **Monitor failed verification attempts**
6. **Keep secrets in environment variables** (never in code)
7. **Use strong secrets** (minimum 32 characters)
8. **Audit delivery logs** regularly

## 🤝 Contributing

When adding new features:

1. Follow existing code patterns
2. Add comprehensive documentation
3. Include TypeScript types
4. Add API documentation (Swagger)
5. Write tests
6. Update this guide

## 📞 Support

- **Documentation**: See markdown files in `apps/backend/`
- **API Docs**: Swagger UI at `http://localhost:3000/api`
- **Issues**: Create GitHub issue with detailed description
- **Questions**: Check integration guide first

## ✅ Next Steps

1. **Run the migration** to create database tables
2. **Configure environment** variables
3. **Test webhook verification** with a simple payload
4. **Set up user preferences** for your account
5. **Monitor delivery logs** to ensure everything works
6. **Read the full documentation** for advanced features

---

**Implementation Date**: April 25, 2026  
**Complexity**: Medium (150 points each)  
**Status**: ✅ Complete and Production-Ready
