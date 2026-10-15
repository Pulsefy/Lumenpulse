# Error Codes Reference

This document provides a mapping of global error codes to their meanings. These codes are returned in the `errorCode` field of all API error responses to assist with frontend troubleshooting and logging.

## Error Response Format

```json
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "UnauthorizedException",
  "errorCode": "AUTH_001",
  "timestamp": "2026-03-29T17:00:00.000Z",
  "path": "/api/v1/user/profile"
}
```

## Authentication Errors (AUTH_XXX)

| Code | Label | Description |
|------|-------|-------------|
| **AUTH_001** | `AUTH_UNAUTHORIZED` | User is not authenticated. |
| **AUTH_002** | `AUTH_INVALID_TOKEN` | The provided authentication token is invalid. |
| **AUTH_003** | `AUTH_TOKEN_EXPIRED` | The authentication token has expired. |
| **AUTH_004** | `AUTH_MISSING_CREDENTIALS` | Login attempt without required fields. |
| **AUTH_005** | `AUTH_INVALID_CREDENTIALS` | Invalid username or password. |
| **AUTH_006** | `AUTH_EMAIL_NOT_VERIFIED` | Account exists but email verification is required. |
| **AUTH_007** | `AUTH_USER_DISABLED` | This account has been disabled by an administrator. |

## System/General Errors (SYS_XXX)

| Code | Label | Description |
|------|-------|-------------|
| **SYS_001** | `SYS_INTERNAL_ERROR` | An unexpected error occurred on the server. |
| **SYS_002** | `SYS_SERVICE_UNAVAILABLE` | Service is temporarily down for maintenance. |
| **SYS_003** | `SYS_EXTERNAL_SERVICE_TIMEOUT` | An external dependency (e.g., Stellar Network) timed out. |
| **SYS_004** | `SYS_VALIDATION_FAILED` | Input data failed validation (e.g., DTO validation). |
| **SYS_005** | `SYS_NOT_FOUND` | The requested resource does not exist. |
| **SYS_006** | `SYS_FORBIDDEN` | User is authenticated but lacks permission for this action. |
| **SYS_007** | `SYS_BAD_REQUEST` | The server could not understand the request due to invalid syntax. |
| **SYS_008** | `SYS_RATE_LIMIT_EXCEEDED` | Too many requests from this IP or account. |
| **SYS_009** | `SYS_CONFLICT` | Resource state conflict (e.g., duplicate entry). |

## User Errors (USER_XXX)

| Code | Label | Description |
|------|-------|-------------|
| **USER_001** | `USER_NOT_FOUND` | Specified user could not be found. |
| **USER_002** | `USER_ALREADY_EXISTS` | Attempted to create a user with an existing email/handle. |
| **USER_003** | `USER_INVALID_DATA` | Provided user profile data is invalid. |

## Stellar/Blockchain Errors (STEL_XXX)

| Code | Label | Description |
|------|-------|-------------|
| **STEL_001** | `STEL_WALLET_NOT_FOUND` | User does not have a linked Stellar wallet. |
| **STEL_002** | `STEL_INSUFFICIENT_FUNDS` | Wallet has insufficient XLM or asset balance for transaction. |
| **STEL_003** | `STEL_TRANSACTION_FAILED` | Horizon or Soroban transaction failed. |
| **STEL_004** | `STEL_INVALID_ADDRESS` | Provided Stellar address is malformed. |

## News & Analytics Errors (ANLY_XXX)

| Code | Label | Description |
|------|-------|-------------|
| **ANLY_001** | `ANLY_SENTIMENT_ANALYSIS_FAILED` | Error during AI sentiment scoring. |
| **ANLY_002** | `ANLY_NEWS_SYNC_FAILED` | Failed to pull latest news from external providers. |
| **ANLY_003** | `ANLY_DATA_NOT_FOUND` | Statistical analysis request for empty dataset. |
