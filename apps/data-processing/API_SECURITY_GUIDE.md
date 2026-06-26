# API Security Implementation Guide

## Overview

The Data Processing FastAPI server is now secured with:
1. **API Key Authentication** - Middleware to validate `X-API-Key` header
2. **Rate Limiting** - Per-client rate limiting using SlowAPI
3. **Configurable Security** - All settings via environment variables in `.env`

## 🔒 Security Features

### 1. API Key Authentication

All endpoints except `/health`, `/metrics`, and `/` require a valid API key in the `X-API-Key` header.

**How it works:**
- Middleware intercepts all incoming requests
- Checks for `X-API-Key` header
- Validates against the configured API key in `.env`
- Returns 401/403 if missing or invalid

**Protected Endpoints:**
- `POST /analyze` - Sentiment analysis
- `POST /analyze-batch` - Batch sentiment analysis

**Public Endpoints (No Auth):**
- `GET /health` - Health check
- `GET /metrics` - Prometheus metrics
- `GET /` - API information

### 2. Rate Limiting

Rate limiting is applied per client IP address using SlowAPI.

**Default Limits:**
- Root endpoint (`/`): 20 requests/minute
- Health check (`/health`): 30 requests/minute
- Analyze endpoint (`/analyze`): 50 requests/minute
- Batch analyze (`/analyze-batch`): 10 requests/minute

**Configuration:**
- Default rate: `100/minute` (general fallback)
- Strict rate: `10/minute` (for sensitive endpoints)

## 📋 Configuration

### Environment Variables (.env)

Create a `.env` file based on `.env.example`:

```bash
# API Security Configuration
API_KEY=your-secure-api-key-here
RATE_LIMIT_DEFAULT=100/minute
RATE_LIMIT_STRICT=10/minute
RATE_LIMIT_ENABLED=true
```

**Variables:**
- `API_KEY`: Your secret API key (change from default!)
- `RATE_LIMIT_DEFAULT`: Default rate limit for all endpoints
- `RATE_LIMIT_STRICT`: Stricter limit for sensitive endpoints
- `RATE_LIMIT_ENABLED`: Enable/disable rate limiting (true/false)

**Rate Limit Formats:**
- `N/second` - Requests per second
- `N/minute` - Requests per minute
- `N/hour` - Requests per hour
- `N/day` - Requests per day

## 🚀 Usage

### Starting the Server

```bash
# Navigate to data-processing directory
cd apps/data-processing

# Start the API server
python start_api.py
```

**Output:**
```
Starting Sentiment Analysis API...
API will be available at: http://localhost:8000
Endpoints: POST /analyze, GET /health, GET /metrics
Security: API key required (X-API-Key header)
Rate limiting: Enabled per API key
Press Ctrl+C to stop
```

### Making Authenticated Requests

#### Using curl

```bash
# Health check (no auth required)
curl http://localhost:8000/health

# Sentiment analysis (auth required)
curl -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secure-api-key-here" \
  -d '{"text": "This is amazing!"}'
```

#### Using Python requests

```python
import requests

API_KEY = "your-secure-api-key-here"
BASE_URL = "http://localhost:8000"

# Health check (no auth)
response = requests.get(f"{BASE_URL}/health")
print(response.json())

# Sentiment analysis (auth required)
headers = {"X-API-Key": API_KEY}
data = {"text": "This is great!"}
response = requests.post(f"{BASE_URL}/analyze", headers=headers, json=data)
print(response.json())
```

#### Using JavaScript fetch

```javascript
const API_KEY = "your-secure-api-key-here";
const BASE_URL = "http://localhost:8000";

// Sentiment analysis
const response = await fetch(`${BASE_URL}/analyze`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': API_KEY
  },
  body: JSON.stringify({ text: "This is awesome!" })
});

const result = await response.json();
console.log(result);
```

## 🧪 Testing

### Run Security Tests

A comprehensive test suite is provided:

```bash
# Start the server first
python start_api.py

# In another terminal, run tests
python test_security.py
```

**Test Coverage:**
1. ✓ Health endpoint (no auth required)
2. ✓ Metrics endpoint (no auth required)
3. ✓ Missing API key rejection
4. ✓ Invalid API key rejection
5. ✓ Valid API key acceptance
6. ✓ Rate limiting enforcement
7. ✓ Root endpoint information

### Manual Testing

```bash
# Test 1: Missing API key (should fail)
curl -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -d '{"text": "test"}'

# Expected: 401 Unauthorized

# Test 2: Invalid API key (should fail)
curl -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -H "X-API-Key: wrong-key" \
  -d '{"text": "test"}'

# Expected: 403 Forbidden

# Test 3: Valid API key (should succeed)
curl -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secure-api-key-here" \
  -d '{"text": "This is great!"}'

# Expected: 200 OK with sentiment score
```

## 🔍 Response Codes

### Authentication Errors

**401 Unauthorized** - Missing API key
```json
{
  "detail": "Missing API key. Please provide X-API-Key header."
}
```

**403 Forbidden** - Invalid API key
```json
{
  "detail": "Invalid API key"
}
```

**429 Too Many Requests** - Rate limit exceeded
```json
{
  "detail": "Rate limit exceeded",
  "message": "Too many requests. Please try again later.",
  "retry_after": "119.43296909332275"
}
```

## 🏗️ Architecture

### File Structure

```
apps/data-processing/
├── src/
│   ├── api/
│   │   └── server.py          # FastAPI server with security integrated
│   └── security.py            # Security middleware module
├── .env                       # Your configuration (create from .env.example)
├── .env.example              # Template configuration
├── start_api.py              # Startup script
└── test_security.py          # Security test suite
```

### Security Flow

```
Request → CORS Middleware → API Key Middleware → Rate Limiter → Endpoint
                              ↓                      ↓
                          401/403 if            429 if limit
                          invalid/missing         exceeded
```

### Middleware Chain

1. **CORS Middleware** - Handles cross-origin requests
2. **Metrics & Logging Middleware** - Tracks requests and correlation IDs
3. **API Key Middleware** - Validates authentication
4. **Rate Limiter** - Enforces rate limits
5. **Endpoint Handler** - Processes the request

## 🛡️ Best Practices

### Production Deployment

1. **Change the default API key**
   ```bash
   # Generate a secure random key
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

2. **Use Redis for rate limiting storage**
   ```python
   # In src/security.py, change:
   storage_uri="redis://localhost:6379"  # Instead of memory://
   ```

3. **Enable HTTPS** - Always use HTTPS in production

4. **Rotate API keys regularly** - Update keys periodically

5. **Monitor rate limits** - Watch for 429 responses in logs

### Development vs Production

**.env (Development):**
```bash
API_KEY=dev-key-12345
RATE_LIMIT_ENABLED=true
RATE_LIMIT_DEFAULT=100/minute
```

**.env (Production):**
```bash
API_KEY=<secure-random-key>
RATE_LIMIT_ENABLED=true
RATE_LIMIT_DEFAULT=50/minute
RATE_LIMIT_STRICT=5/minute
```

## 🔧 Troubleshooting

### Issue: "API_KEY environment variable must be set"

**Solution:** Create a `.env` file with an API_KEY value:
```bash
API_KEY=your-key-here
```

### Issue: Rate limiting not working

**Check:**
1. `RATE_LIMIT_ENABLED=true` in `.env`
2. Restart the server after changing `.env`
3. Check logs for rate limiter initialization

### Issue: Getting 401 on all endpoints

**Check:**
1. You're sending the `X-API-Key` header
2. The API key matches exactly (case-sensitive)
3. Health/metrics endpoints should work without auth

### Issue: Connection refused

**Solution:** Make sure the server is running:
```bash
python start_api.py
```

## 📚 Additional Resources

- [SlowAPI Documentation](https://slowapi.readthedocs.io/)
- [FastAPI Security](https://fastapi.tiangolo.com/tutorial/security/)
- [API Key Authentication Best Practices](https://owasp.org/www-community/controls/API_Security_Cheat_Sheet)

## ✅ Acceptance Criteria Met

- ✓ Middleware to check for X-API-Key header
- ✓ Rate limiting per API key (using slowapi)
- ✓ Configurable keys via .env
- ✓ Professional implementation with proper error handling
- ✓ Comprehensive documentation and testing
