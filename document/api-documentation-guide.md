# LumenPulse API Documentation Guide

## Overview

This guide provides comprehensive information about the LumenPulse backend API, including authentication, endpoints, request/response formats, and best practices for integration.

## Base URLs

- **Development**: `http://localhost:3000`
- **Production**: `https://api.lumenpulse.io`

## Interactive Documentation

The API includes interactive Swagger/OpenAPI documentation accessible at:

- **Development**: `http://localhost:3000/api/docs`
- **Production**: `https://api.lumenpulse.io/api/docs`

The Swagger UI allows you to:
- Browse all available endpoints
- View detailed request/response schemas
- Test endpoints directly from the browser
- Download the OpenAPI specification

## Authentication

### Overview

LumenPulse API supports two authentication methods:

1. **Email/Password Authentication** - Traditional login with JWT tokens
2. **Stellar Wallet Authentication** - Passwordless authentication using Stellar wallet signatures

### JWT Token Authentication

All authenticated endpoints require a Bearer token in the Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

#### Login Flow

1. **Register** (if new user)
   ```
   POST /auth/register
   {
     "email": "user@example.com",
     "password": "SecurePass123!"
   }
   ```

2. **Login**
   ```
   POST /auth/login
   {
     "email": "user@example.com",
     "password": "SecurePass123!"
   }
   ```
   
   Response:
   ```json
   {
     "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
     "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
   }
   ```

3. **Use Access Token** in subsequent requests

4. **Refresh Token** when access token expires
   ```
   POST /auth/refresh
   {
     "refreshToken": "your_refresh_token",
     "deviceInfo": "iPhone 15 Pro"
   }
   ```

### Stellar Wallet Authentication

Passwordless authentication using Stellar wallet signatures:

1. **Get Challenge**
   ```
   GET /auth/challenge?publicKey=GCZJM35NKGVK47BB4SPBDV25477PZYIYPVVG453LPYFNXLS3FGHDXOCM
   ```
   
   Response:
   ```json
   {
     "challenge": "AAAAAgAAAAD...",
     "nonce": "abc123",
     "expiresIn": 300
   }
   ```

2. **Sign Challenge** with your Stellar wallet (e.g., Freighter)

3. **Verify Signature**
   ```
   POST /auth/verify
   {
     "publicKey": "GCZJM35NKGVK47BB4SPBDV25477PZYIYPVVG453LPYFNXLS3FGHDXOCM",
     "signedChallenge": "AAAAAgAAAAD..."
   }
   ```
   
   Response:
   ```json
   {
     "success": true,
     "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
     "user": {
       "id": "user-123",
       "stellarPublicKey": "GCZJM35NKGVK47BB4SPBDV25477PZYIYPVVG453LPYFNXLS3FGHDXOCM"
     }
   }
   ```

### Password Reset Flow

1. **Request Reset Token**
   ```
   POST /auth/forgot-password
   {
     "email": "user@example.com"
   }
   ```

2. **Reset Password** (using token from email)
   ```
   POST /auth/reset-password
   {
     "token": "reset_token_from_email",
     "newPassword": "NewSecurePass123!"
   }
   ```

## API Endpoints

### Authentication (`/auth`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/auth/register` | Register new user | No |
| POST | `/auth/login` | Login with email/password | No |
| POST | `/auth/refresh` | Refresh access token | No |
| POST | `/auth/logout` | Logout and invalidate refresh token | No |
| POST | `/auth/logout-all` | Logout from all devices | Yes |
| GET | `/auth/profile` | Get current user profile | Yes |
| GET | `/auth/challenge` | Get Stellar wallet challenge | No |
| POST | `/auth/verify` | Verify signed challenge | No |
| POST | `/auth/forgot-password` | Request password reset | No |
| POST | `/auth/reset-password` | Reset password with token | No |

### Users (`/users`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/users` | Get all users (Admin) | Yes |
| GET | `/users/:id` | Get user by ID | Yes |
| GET | `/users/me` | Get current user profile | Yes |
| PATCH | `/users/me` | Update current user profile | Yes |
| POST | `/users/me/accounts` | Link Stellar account | Yes |
| GET | `/users/me/accounts` | Get linked Stellar accounts | Yes |
| GET | `/users/me/accounts/:id` | Get specific Stellar account | Yes |
| DELETE | `/users/me/accounts/:id` | Unlink Stellar account | Yes |
| PATCH | `/users/me/accounts/:id/label` | Update account label | Yes |
| POST | `/users/me/accounts/:id/primary` | Set primary account | Yes |

### News (`/news`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/news` | Get latest crypto news | No |
| GET | `/news/search` | Search news articles | No |
| GET | `/news/categories` | Get news categories | No |
| GET | `/news/article` | Get single article | No |
| GET | `/news/coin/:symbol` | Get news for specific coin | No |
| GET | `/news/sentiment-summary` | Get sentiment analysis | No |

### Portfolio (`/portfolio`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/portfolio/history` | Get portfolio snapshots | Yes |
| POST | `/portfolio/snapshot` | Create portfolio snapshot | Yes |
| POST | `/portfolio/snapshots/trigger` | Trigger snapshots for all users (Admin) | Yes |
| GET | `/portfolio/performance` | Get performance metrics | Yes |

### Stellar (`/stellar`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/stellar/accounts/:publicKey/balances` | Get account balances | No |
| GET | `/stellar/health` | Check Horizon API health | No |
| GET | `/stellar/assets` | Discover Stellar assets | No |

## Common Request/Response Patterns

### Pagination

Endpoints that return lists support pagination:

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10, max: 100)

**Response Format:**
```json
{
  "items": [...],
  "total": 150,
  "page": 1,
  "limit": 10,
  "totalPages": 15
}
```

### Error Responses

All errors follow a consistent format:

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request"
}
```

**Common Status Codes:**
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (missing or invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `500` - Internal Server Error

## Data Models

### User Profile

```typescript
{
  id: string;
  email: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  stellarPublicKey?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### News Article

```typescript
{
  id: string;
  guid: string;
  title: string;
  subtitle?: string;
  body: string;
  url: string;
  imageUrl?: string;
  authors: string;
  source: string;
  sourceKey: string;
  categories: string[];
  keywords: string[];
  sentiment: string;
  publishedAt: string;
  relatedCoins: string[];
}
```

### Portfolio Snapshot

```typescript
{
  id: string;
  userId: string;
  createdAt: Date;
  assetBalances: Array<{
    assetCode: string;
    assetIssuer?: string;
    amount: string;
    valueUsd: number;
  }>;
  totalValueUsd: string;
}
```

### Portfolio Performance

```typescript
{
  userId: string;
  currentValueUsd: number;
  calculatedAt: Date;
  windows: Array<{
    window: '24h' | '7d' | '30d';
    hasData: boolean;
    absolutePnl?: number;
    percentageChange?: number;
    currentValueUsd: number;
    baselineValueUsd?: number;
    baselineDate?: Date;
  }>;
}
```

## Rate Limiting

The API implements rate limiting to prevent abuse:

- **Default**: 100 requests per 15 minutes per IP
- **Authenticated**: 1000 requests per 15 minutes per user

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1614556800
```

## CORS

CORS is configured to allow requests from:
- Development: `http://localhost:3000`, `http://localhost:3001`
- Production: Configured via `CORS_ORIGIN` environment variable

## Best Practices

### 1. Token Management

- Store access tokens securely (e.g., httpOnly cookies or secure storage)
- Implement automatic token refresh before expiration
- Handle 401 responses by refreshing tokens or redirecting to login

### 2. Error Handling

```typescript
try {
  const response = await fetch('/api/endpoint', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) {
    const error = await response.json();
    // Handle error based on statusCode
  }
  
  const data = await response.json();
  // Process data
} catch (error) {
  // Handle network errors
}
```

### 3. Pagination

```typescript
async function fetchAllItems() {
  let page = 1;
  let allItems = [];
  let hasMore = true;
  
  while (hasMore) {
    const response = await fetch(`/api/endpoint?page=${page}&limit=50`);
    const data = await response.json();
    
    allItems = [...allItems, ...data.items];
    hasMore = page < data.totalPages;
    page++;
  }
  
  return allItems;
}
```

### 4. Stellar Integration

When working with Stellar accounts:
- Always validate public key format (starts with 'G', 56 characters)
- Handle network errors gracefully (Horizon API may be temporarily unavailable)
- Cache asset information to reduce API calls
- Use testnet for development (`STELLAR_NETWORK=testnet`)

## Testing Endpoints

### Using Swagger UI

1. Navigate to `/api/docs`
2. Click "Authorize" button
3. Enter your JWT token: `Bearer <token>`
4. Test endpoints directly from the UI

### Using cURL

```bash
# Login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'

# Get news (no auth required)
curl http://localhost:3000/news?limit=10

# Get portfolio (auth required)
curl http://localhost:3000/portfolio/history \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Using Postman

1. Import the OpenAPI spec from `/api/docs-json`
2. Set up environment variables for base URL and tokens
3. Use collection runner for automated testing

## Troubleshooting

### Common Issues

**401 Unauthorized**
- Check if token is included in Authorization header
- Verify token hasn't expired
- Try refreshing the token

**400 Bad Request**
- Check request body matches expected schema
- Verify all required fields are present
- Check data types and formats

**404 Not Found**
- Verify endpoint URL is correct
- Check if resource exists
- Ensure you're using the correct HTTP method

**503 Service Unavailable**
- Stellar Horizon API may be down
- Check `/stellar/health` endpoint
- Retry with exponential backoff

## Support

For API issues or questions:
- Check the interactive docs at `/api/docs`
- Review this documentation
- Open an issue on GitHub
- Join the [LumenPulse Discord](https://discord.gg/gBmApTNVV)

## Changelog

### Version 1.0 (Current)
- Initial API release
- Email/password authentication
- Stellar wallet authentication
- News aggregation endpoints
- Portfolio tracking and performance metrics
- Stellar blockchain integration

---

**Last Updated**: February 25, 2026
**API Version**: 1.0
