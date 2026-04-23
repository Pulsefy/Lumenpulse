# API Security - Quick Reference

## 🔑 Quick Start

### 1. Setup (First Time Only)

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env and set your API key
API_KEY=your-secure-random-key-here
```

### 2. Start Server

```bash
python start_api.py
```

### 3. Test It Works

```bash
# Health check (no auth needed)
curl http://localhost:8000/health

# With authentication
curl -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secure-random-key-here" \
  -d '{"text": "This is great!"}'
```

---

## 📝 Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_KEY` | ✅ Yes | - | Your secret API key |
| `RATE_LIMIT_DEFAULT` | ❌ No | `100/minute` | Default rate limit |
| `RATE_LIMIT_STRICT` | ❌ No | `10/minute` | Strict rate limit |
| `RATE_LIMIT_ENABLED` | ❌ No | `true` | Enable/disable rate limiting |

---

## 🔒 Authentication

**Header Name:** `X-API-Key`

**Required for:** All endpoints except:
- `GET /health`
- `GET /metrics`
- `GET /`

**Example:**
```bash
curl -H "X-API-Key: your-api-key" http://localhost:8000/analyze
```

---

## 📊 Rate Limits

| Endpoint | Method | Rate Limit |
|----------|--------|------------|
| `/` | GET | 20/minute |
| `/health` | GET | 30/minute |
| `/metrics` | GET | No limit |
| `/analyze` | POST | 50/minute |
| `/analyze-batch` | POST | 10/minute |

---

## 💻 Code Examples

### Python

```python
import requests

API_KEY = "your-api-key"
BASE_URL = "http://localhost:8000"

headers = {"X-API-Key": API_KEY}

# Analyze sentiment
response = requests.post(
    f"{BASE_URL}/analyze",
    headers=headers,
    json={"text": "I love this product!"}
)

print(response.json())  # {"sentiment": 0.8439}
```

### JavaScript/Node.js

```javascript
const fetch = require('node-fetch');

const API_KEY = "your-api-key";
const BASE_URL = "http://localhost:8000";

// Analyze sentiment
const response = await fetch(`${BASE_URL}/analyze`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': API_KEY
  },
  body: JSON.stringify({ text: "Amazing!" })
});

const result = await response.json();
console.log(result);
```

### cURL

```bash
# Single analysis
curl -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"text": "Excellent service!"}'

# Batch analysis
curl -X POST http://localhost:8000/analyze-batch \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '["Great!", "Terrible...", "Okay"]'
```

---

## 🧪 Testing

### Run Full Test Suite

```bash
python test_security.py
```

### Manual Tests

```bash
# Test missing API key (should return 401)
curl -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -d '{"text": "test"}'

# Test invalid API key (should return 403)
curl -X POST http://localhost:8000/analyze \
  -H "X-API-Key: wrong-key" \
  -H "Content-Type: application/json" \
  -d '{"text": "test"}'

# Test valid API key (should return 200)
curl -X POST http://localhost:8000/analyze \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"text": "Perfect!"}'
```

---

## ⚠️ Common Errors

### 401 Unauthorized
```json
{"detail": "Missing API key. Please provide X-API-Key header."}
```
**Fix:** Add `-H "X-API-Key: your-api-key"` to your request

### 403 Forbidden
```json
{"detail": "Invalid API key"}
```
**Fix:** Check that your API key matches exactly (case-sensitive)

### 429 Too Many Requests
```json
{
  "detail": "Rate limit exceeded",
  "message": "Too many requests. Please try again later."
}
```
**Fix:** Slow down your requests or increase rate limit in `.env`

---

## 🛠️ Troubleshooting

| Problem | Solution |
|---------|----------|
| Getting 401 on all requests | Check `X-API-Key` header is set correctly |
| Rate limiting not working | Ensure `RATE_LIMIT_ENABLED=true` in `.env` |
| Server won't start | Check `.env` file exists with `API_KEY` set |
| Connection refused | Run `python start_api.py` to start server |

---

## 📖 Full Documentation

See [`API_SECURITY_GUIDE.md`](./API_SECURITY_GUIDE.md) for complete documentation.

---

## 🔐 Generate Secure API Key

```bash
# Python
python -c "import secrets; print(secrets.token_urlsafe(32))"

# OpenSSL
openssl rand -base64 32

# PowerShell (Windows)
-join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object {[char]$_})
```

---

**Quick Reference Card | LumenPulse Data Processing API**
