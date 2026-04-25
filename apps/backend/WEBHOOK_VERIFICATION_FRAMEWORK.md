# Webhook Signature Verification Framework

A reusable framework for verifying signed webhooks from trusted third-party providers or internal services.

## Features

- **Multiple Signature Algorithms**: HMAC-SHA256, HMAC-SHA512, RSA-SHA256, Ed25519
- **Multi-Provider Support**: Configure multiple webhook providers with different algorithms
- **Runtime Provider Management**: Add, update, or remove providers without restarting
- **Replay Protection**: Timestamp-based validation to prevent replay attacks
- **IP Whitelisting**: Optional IP address filtering per provider
- **Guard-Based Verification**: Easy-to-use NestJS guard with decorator support
- **Backward Compatible**: Works with existing webhook implementations

## Architecture

```
Webhook Request
    ↓
WebhookVerificationGuard
    ↓
WebhookVerificationService
    ↓
Provider Configuration
    ↓
Algorithm-Specific Verifier
    ↓
Verification Result
```

## Quick Start

### 1. Configure Providers

Add webhook providers to your environment:

```bash
# Single provider (legacy)
WEBHOOK_SECRET=your-secret-key

# Multiple providers (recommended)
WEBHOOK_PROVIDERS='[
  {
    "name": "data-processing",
    "algorithm": "hmac-sha256",
    "secret": "your-secret-key",
    "enabled": true
  },
  {
    "name": "external-service",
    "algorithm": "rsa-sha256",
    "publicKey": "base64-encoded-public-key",
    "enabled": true,
    "timestampToleranceMs": 300000
  }
]'
```

### 2. Use the Guard

```typescript
import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import {
  WebhookVerificationGuard,
  WebhookProvider,
} from './webhook-verification.guard';

@Controller('webhooks')
export class MyWebhookController {
  @Post('my-endpoint')
  @UseGuards(WebhookVerificationGuard)
  @WebhookProvider('data-processing')
  async handleWebhook(@Req() req: Request, @Body() payload: any) {
    // Signature already verified by the guard
    return { status: 'ok' };
  }
}
```

### 3. Admin API - Register Provider at Runtime

```typescript
POST /webhooks/admin/providers
{
  "name": "my-provider",
  "algorithm": "hmac-sha256",
  "secret": "my-secret",
  "enabled": true
}
```

## Supported Algorithms

### HMAC-SHA256

```typescript
// Provider config
{
  "name": "my-hmac-provider",
  "algorithm": "hmac-sha256",
  "secret": "shared-secret",
  "enabled": true
}

// Client sends header:
// X-Webhook-Signature: sha256=<hex-hash>
```

### HMAC-SHA512

```typescript
// Provider config
{
  "name": "my-hmac512-provider",
  "algorithm": "hmac-sha512",
  "secret": "shared-secret",
  "enabled": true
}

// Client sends header:
// X-Webhook-Signature: sha512=<hex-hash>
```

### RSA-SHA256

```typescript
// Provider config
{
  "name": "my-rsa-provider",
  "algorithm": "rsa-sha256",
  "publicKey": "base64-encoded-public-key",
  "enabled": true,
  "timestampToleranceMs": 300000
}

// Client sends headers:
// X-Webhook-Signature: rsa256=<base64-signature>
// X-Webhook-Timestamp: 1234567890
```

### Ed25519

```typescript
// Provider config
{
  "name": "my-ed25519-provider",
  "algorithm": "ed25519",
  "publicKey": "base64-encoded-public-key",
  "enabled": true,
  "timestampToleranceMs": 300000
}

// Client sends headers:
// X-Webhook-Signature: ed25519=<base64-signature>
// X-Webhook-Timestamp: 1234567890
```

## API Endpoints

### Admin Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/webhooks/admin/providers` | List all providers |
| GET | `/webhooks/admin/providers/:name` | Get provider details |
| POST | `/webhooks/admin/providers` | Register new provider |
| PUT | `/webhooks/admin/providers/:name` | Update provider |
| DELETE | `/webhooks/admin/providers/:name` | Disable provider |

### Webhook Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/webhooks/data-processing` | Data processing events (signed) |

## Configuration Options

```typescript
interface WebhookProviderConfig {
  name: string;                      // Unique identifier
  algorithm: WebhookSignatureAlgorithm;
  secret?: string;                   // For HMAC
  publicKey?: string;                // For RSA/Ed25519 (base64)
  enabled: boolean;
  timestampToleranceMs?: number;     // Replay protection
  signatureHeader?: string;          // Custom header name
  timestampHeader?: string;          // Custom timestamp header
  allowedIps?: string[];             // IP whitelist
}
```

## Security Considerations

1. **Always use HTTPS** for webhook endpoints
2. **Rotate secrets** regularly
3. **Enable timestamp validation** to prevent replay attacks
4. **Use IP whitelisting** when possible
5. **Monitor failed verification attempts** in logs
6. **Use constant-time comparison** (implemented) to prevent timing attacks

## Examples

### Generating HMAC-SHA256 Signature (Python)

```python
import hmac
import hashlib

def generate_signature(payload: str, secret: str) -> str:
    signature = hmac.new(
        secret.encode('utf-8'),
        payload.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    return f"sha256={signature}"

# Usage
headers = {
    'X-Webhook-Signature': generate_signature(payload, secret)
}
```

### Generating RSA-SHA256 Signature (Node.js)

```typescript
import * as crypto from 'crypto';

function generateRSASignature(payload: Buffer, privateKey: string): string {
  const sign = crypto.createSign('SHA256');
  sign.update(payload);
  sign.end();
  const signature = sign.sign(privateKey, 'base64');
  return `rsa256=${signature}`;
}
```

## Migration Guide

### From Legacy Single Secret

If you're using the old `WEBHOOK_SECRET` approach:

1. The system automatically creates a "legacy" provider from `WEBHOOK_SECRET`
2. Gradually migrate to the new provider configuration
3. Update controllers to use `@WebhookProvider('legacy')`
4. Eventually remove `WEBHOOK_SECRET` and use only `WEBHOOK_PROVIDERS`

## Testing

```bash
# Test with curl
curl -X POST http://localhost:3000/webhooks/data-processing \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: sha256=<signature>" \
  -d '{"event":"high_priority_insight","type":"anomaly",...}'
```
