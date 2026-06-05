# Soroban Event Ingestion Webhook

Secured endpoint for ingesting Soroban contract events from the testnet indexer into the processing pipeline.

## Endpoint

```
POST /soroban-events/ingest
```

## Authentication

Requests are authenticated using **HMAC-SHA256** with a shared secret, plus replay protection via timestamp + nonce.

### Required Headers

| Header | Description |
|--------|-------------|
| `X-Soroban-Timestamp` | Unix epoch milliseconds. Must be within the configured tolerance window (default: 5 minutes). |
| `X-Soroban-Nonce` | Unique per-request value. Combined with timestamp to prevent replay attacks. |
| `X-Soroban-Signature` | HMAC-SHA256 hex digest of `{timestamp}.{nonce}.{requestBody}` signed with the shared secret. |

### Signature Algorithm

```
signature = HMAC-SHA256(secret, `${timestamp}.${nonce}.${rawRequestBody}`)
```

Where:
- `timestamp` is the value from `X-Soroban-Timestamp` header
- `nonce` is the value from `X-Soroban-Nonce` header
- `rawRequestBody` is the raw UTF-8 request body (not parsed JSON)

## Request Body

```json
{
  "txHash": "a1b2c3d4...",
  "eventIndex": 0,
  "contractId": "CC...",
  "eventType": "transfer",
  "rawPayload": { ... }
}
```

## Response Codes

| Code | Description |
|------|-------------|
| 202 | Event accepted for background processing |
| 401 | Missing or invalid signature, timestamp expired, or invalid nonce |

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `SOROBAN_INGEST_SECRET` | — | Shared HMAC secret (required) |
| `SOROBAN_TIMESTAMP_TOLERANCE_MS` | `300000` | Max age of timestamp in milliseconds |

## Client Example (Node.js)

```typescript
import * as crypto from 'crypto';

function signSorobanEvent(
  body: object,
  secret: string,
): { signature: string; timestamp: string; nonce: string } {
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const rawBody = JSON.stringify(body);
  const payload = `${timestamp}.${nonce}.${rawBody}`;

  const signature = crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex');

  return { signature, timestamp, nonce };
}

// Usage
const { signature, timestamp, nonce } = signSorobanEvent(
  { txHash: '...', eventIndex: 0, rawPayload: {} },
  process.env.SOROBAN_INGEST_SECRET,
);

const response = await fetch('https://api.lumenpulse.io/soroban-events/ingest', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Soroban-Timestamp': timestamp,
    'X-Soroban-Nonce': nonce,
    'X-Soroban-Signature': signature,
  },
  body: JSON.stringify(body),
});
```

## Client Example (Python)

```python
import hmac
import hashlib
import json
import time
import uuid

def sign_soroban_event(body: dict, secret: str) -> dict:
    timestamp = str(int(time.time() * 1000))
    nonce = str(uuid.uuid4())
    raw_body = json.dumps(body, separators=(',', ':'))
    payload = f"{timestamp}.{nonce}.{raw_body}"

    signature = hmac.new(
        secret.encode('utf-8'),
        payload.encode('utf-8'),
        hashlib.sha256,
    ).hexdigest()

    return {
        'X-Soroban-Timestamp': timestamp,
        'X-Soroban-Nonce': nonce,
        'X-Soroban-Signature': signature,
    }

# Usage
import requests

headers = sign_soroban_event(
    {"txHash": "...", "eventIndex": 0, "rawPayload": {}},
    "your-soroban-ingest-secret",
)
headers['Content-Type'] = 'application/json'

response = requests.post(
    'https://api.lumenpulse.io/soroban-events/ingest',
    headers=headers,
    data=json.dumps(body),
)
```

## Replay Protection

The endpoint enforces the following checks on every request:

1. **Timestamp validity**: `X-Soroban-Timestamp` must be a positive integer (Unix ms)
2. **Future rejection**: Requests with a timestamp in the future are rejected
3. **Age check**: Requests older than `SOROBAN_TIMESTAMP_TOLERANCE_MS` (default: 5 minutes) are rejected
4. **Nonce binding**: The nonce is included in the HMAC payload, so each signature is unique per request
5. **Constant-time comparison**: Signature comparison uses `crypto.timingSafeEqual` to prevent timing attacks
