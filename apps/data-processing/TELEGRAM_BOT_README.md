# LumenPulse Interactive Telegram Bot

## Overview

The LumenPulse Telegram Bot has been extended from a "push-only" alert system to a fully interactive bot with command support and per-user subscription management. This enhancement allows users to interact with the bot, customize their alert preferences, and access real-time market information on demand.

## Features

### 🤖 Interactive Commands
- `/start` - Welcome message and bot introduction
- `/help` - List all available commands
- `/status` - Current market sentiment status
- `/price [asset]` - Get price information (default: XLM)
- `/sentiment` - Latest sentiment analysis summary
- `/trend` - Current market trend analysis
- `/silence [hours]` - Mute alerts for specified duration (1-24 hours)
- `/subscribe [type]` - Subscribe to specific alert types
- `/unsubscribe [type]` - Unsubscribe from specific alert types
- `/settings` - View and manage subscription preferences

### 🔔 Subscription Management
- **Per-user subscriptions**: Each user/channel has individual preferences
- **Alert type filtering**: Subscribe/unsubscribe to sentiment, price, trend, or news alerts
- **Silence functionality**: Temporarily mute alerts without unsubscribing
- **Database-backed**: All preferences stored persistently

### 📊 Command Analytics
- **Command history**: Track all bot commands for analytics
- **Success metrics**: Monitor command processing success rates
- **Usage statistics**: Understand which features are most popular

### 🛡️ Reliability Features
- **Thread-safe operations**: Handle concurrent requests safely
- **Error handling**: Graceful error recovery and user feedback
- **Rate limiting**: Respect Telegram API limits with exponential backoff
- **Retry logic**: Automatic retries for failed requests

## Architecture

### Database Schema

#### Telegram Subscriptions Table
```sql
telegram_subscriptions:
- chat_id (BigInteger) - Telegram user/channel ID
- chat_type (String) - private, group, supergroup, channel
- username, first_name, last_name - User information
- is_active (Boolean) - Master subscription switch
- sentiment_alerts, price_alerts, trend_alerts, news_alerts - Alert preferences
- is_silenced, silence_until - Mute functionality
- subscribed_assets (JSON) - Asset-specific preferences
- alert_thresholds (JSON) - Custom alert thresholds
- created_at, updated_at, last_interaction - Timestamps
```

#### Telegram Commands Table
```sql
telegram_commands:
- chat_id (BigInteger) - User/channel ID
- command (String) - Command executed
- args (Text) - Command arguments
- response_sent (Boolean) - Success status
- response_text (Text) - Bot response
- processing_time_ms (Integer) - Performance metric
- error_message, error_type - Error tracking
- created_at - Timestamp
```

### Components

1. **InteractiveAlertBot** - Main bot class with command handlers
2. **TelegramWebhookService** - Webhook/polling service for receiving updates
3. **Database Models** - SQLAlchemy models for subscriptions and commands
4. **PostgreSQL Service** - Database operations for subscription management

## Setup Instructions

### Prerequisites

1. **Telegram Bot Token**: Get from [@BotFather](https://t.me/BotFather)
2. **Database**: PostgreSQL with existing LumenPulse schema
3. **Python Dependencies**: See requirements.txt

### Environment Variables

```bash
# Required
TELEGRAM_BOT_TOKEN=your_bot_token_here
DATABASE_URL=postgresql://user:pass@localhost:5432/lumenpulse

# Optional
TELEGRAM_WEBHOOK_URL=https://your-domain.com/webhook
TELEGRAM_CHANNEL_ID=@your_channel  # For legacy broadcast mode
```

### Database Migration

Run the Alembic migration to create the new tables:

```bash
cd apps/data-processing
alembic upgrade head
```

### Installation

1. **Install dependencies**:
```bash
pip install -r requirements.txt
```

2. **Run migrations**:
```bash
alembic upgrade head
```

3. **Start the bot**:

**Option A: Webhook Mode (Recommended for production)**
```python
from src.telegram_webhook import create_fastapi_app, TelegramWebhookService
from src.interactive_alertbot import InteractiveAlertBot
from src.database import DatabaseService

# Initialize services
database_service = DatabaseService()
bot = InteractiveAlertBot(
    telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN"),
    database_service=database_service,
)

# Create webhook service
webhook_service = TelegramWebhookService(
    bot=bot,
    webhook_url=os.getenv("TELEGRAM_WEBHOOK_URL"),
)

# Set up webhook
webhook_service.setup_webhook(webhook_url)

# Create and run FastAPI app
app = create_fastapi_app(webhook_service)
uvicorn.run(app, host="0.0.0.0", port=8000)
```

**Option B: Polling Mode (Good for development)**
```python
from src.telegram_webhook import TelegramWebhookService
from src.interactive_alertbot import InteractiveAlertBot
from src.database import DatabaseService

# Initialize services
database_service = DatabaseService()
bot = InteractiveAlertBot(
    telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN"),
    database_service=database_service,
)

# Create webhook service (polling mode)
webhook_service = TelegramWebhookService(bot=bot)

# Start polling
webhook_service.start_polling()

# Keep running
try:
    while True:
        time.sleep(60)
except KeyboardInterrupt:
    webhook_service.stop_polling()
```

### Docker Deployment

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## Usage Examples

### Basic Commands

```
/start
🚀 Welcome to LumenPulse Alert Bot!
I provide real-time crypto market sentiment analysis and alerts.

Available commands:
/help - Show all commands
/status - Current market status
/price XLM - Get XLM price info
/sentiment - Latest sentiment analysis
```

### Subscription Management

```
/subscribe sentiment
✅ Subscribed to sentiment alerts
You'll receive notifications for this alert type.

/silence 6
🔇 Alerts Silenced
⏰ Duration: 6 hours
🔔 Resume: 2026-04-24 17:52 UTC

/settings
⚙️ Your Subscription Settings
🟢 Status: Active
🔊 Notifications: Enabled

📋 Active Alerts:
  • Sentiment 📊
  • Trends 📈
```

### Market Information

```
/status
📈 Market Status: Positive

📊 Sentiment Score: 0.75
🟢 Positive: 60.0%
🔴 Negative: 20.0%
⚪ Neutral: 20.0%
📰 News Analyzed: 50

Last updated: 2026-04-24T10:30:00Z

/price BTC
💰 BTC Price Information

📈 Current Price: $65,432
📊 24h Change: +2.34%
💎 24h Volume: $1.2B
🏆 Market Cap: $1.28T
```

## API Integration

### Webhook Endpoint

**POST** `/webhook`
- Receives Telegram updates
- Processes commands through InteractiveAlertBot
- Returns success/error status

**GET** `/webhook/status`
- Returns webhook configuration
- Shows bot information
- Displays polling status

**GET** `/health`
- Health check endpoint
- Returns service status

### Database Service Methods

```python
# Subscription management
postgres_service.create_telegram_subscription(subscription)
postgres_service.get_telegram_subscription(chat_id)
postgres_service.update_telegram_subscription(subscription)
postgres_service.get_active_subscribers(alert_type)

# Command analytics
postgres_service.create_telegram_command(command)
postgres_service.get_telegram_command_stats(hours=24)
postgres_service.cleanup_old_telegram_data(days=30)
```

## Testing

Run the test suite:

```bash
cd apps/data-processing
python -m pytest tests/test_interactive_alertbot.py -v
```

Test coverage includes:
- Command handlers
- Subscription management
- Database operations
- Error handling
- Message formatting

## Monitoring

### Metrics Available

1. **Command Usage**: Total commands, success rate, popular commands
2. **Subscription Stats**: Active users, alert type preferences
3. **Error Rates**: Failed commands, API errors
4. **Performance**: Response times, processing duration

### Example Monitoring Query

```sql
-- Get command stats for last 24 hours
SELECT 
    command,
    COUNT(*) as usage_count,
    COUNT(CASE WHEN response_sent = true THEN 1 END) as success_count,
    ROUND(COUNT(CASE WHEN response_sent = true THEN 1 END) * 100.0 / COUNT(*), 2) as success_rate
FROM telegram_commands 
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY command
ORDER BY usage_count DESC;
```

## Troubleshooting

### Common Issues

1. **Webhook not working**
   - Verify webhook URL is accessible
   - Check SSL certificate (Telegram requires HTTPS)
   - Ensure firewall allows incoming requests

2. **Commands not responding**
   - Check bot token is valid
   - Verify database connection
   - Review logs for error messages

3. **Subscription not saving**
   - Check database schema is up to date
   - Verify PostgreSQL connection
   - Review permission settings

### Debug Mode

Enable debug logging:

```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

### Health Check

Monitor bot health:

```bash
curl https://your-domain.com/health
```

## Migration from Original AlertBot

The new `InteractiveAlertBot` is backward compatible with the original `AlertBot`. To migrate:

1. **Update imports**:
```python
# Old
from src.alertbot import AlertBot

# New
from src.interactive_alertbot import InteractiveAlertBot
```

2. **Initialize with database service**:
```python
# Add database service for subscription management
bot = InteractiveAlertBot(
    telegram_bot_token=token,
    database_service=database_service,  # New parameter
)
```

3. **Run database migration**:
```bash
alembic upgrade head
```

## Security Considerations

1. **Bot Token Security**: Never expose bot token in code or logs
2. **Input Validation**: All user inputs are validated and sanitized
3. **Rate Limiting**: Built-in protection against spam and abuse
4. **Error Handling**: Sensitive information never exposed to users

## Future Enhancements

Planned improvements:
- [ ] Inline keyboards for interactive menus
- [ ] Asset-specific alert customization
- [ ] Advanced analytics dashboard
- [ ] Multi-language support
- [ ] Group chat management features
- [ ] Custom alert thresholds per user

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review the test files for usage examples
3. Enable debug logging for detailed error information
4. Check the GitHub issues for known problems

---

**Note**: This enhancement maintains full backward compatibility with existing AlertBot functionality while adding powerful new interactive features.
