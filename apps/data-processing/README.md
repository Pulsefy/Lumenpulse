# LumenPulse Data Processing Service

This service handles compute-heavy tasks such as sentiment analysis and market trend prediction for the StarkPulse project.

## Project Structure

- `src/`: Core logic and service implementation.
- `tests/`: Unit and integration tests.
- `scripts/`: Helper scripts for data management and development.

## Setup Instructions

### 1. Prerequisites

- Python 3.9 or higher

### 2. Create and Activate Virtual Environment

**On Windows:**
```powershell
# Create virtual environment (using Python Launcher)
py -m venv venv

# Activate virtual environment
.\venv\Scripts\activate
```

**On macOS/Linux:**
```bash
python3 -m venv venv
source venv/bin/activate
```

**On Windows:**
```bash
python -m venv venv
venv\Scripts\activate
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

### 4. Environment Variables

Create a `.env` file in the root of `apps/data-processing` and add any necessary configuration.

### 5. Running the Service

```bash
python src/main.py
```

## Telegram Alert Bot Setup

The data processing service can send Telegram alerts when high sentiment scores (>0.8) are detected. Follow these steps to enable alerts:

### 1. Create a Telegram Bot

1. Open Telegram and search for `@BotFather`
2. Send `/newbot` and follow the prompts to create a new bot
3. Copy the **bot token** (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)
4. Keep this token secure - never commit it to source control

### 2. Get Your Channel ID

**For public channels:**
- Use the format `@your_channel_name`

**For private channels/groups:**
1. Add the bot `@userinfobot` to your channel temporarily
2. Send any message - it will reply with the channel ID (starts with `-100`)
3. Remove `@userinfobot` when done

### 3. Add Bot to Channel

1. Open your Telegram channel settings
2. Go to "Administrators" → "Add Administrator"
3. Search for your bot by username
4. Grant permission to "Post messages"

### 4. Configure Environment Variables

Add to your `.env` file:

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHANNEL_ID=@your_channel_name
```

### 5. Test the Integration

Run the integration test to verify setup:

```python
from src.alertbot import AlertBot

bot = AlertBot()
bot.send_alert("🧪 Test: Hello World from Lumenpulse!")
```

### Alert Configuration

- **Threshold**: Alerts trigger when sentiment score > 0.8
- **Rate Limiting**: Automatic retry with exponential backoff
- **Dry-Run Mode**: Set `AlertBot(dry_run=True)` for testing without sending