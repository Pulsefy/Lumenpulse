# API Client Retry Flow Diagram

## Request Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    API Request Initiated                         │
│                   (e.g., apiClient.get('/data'))                │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │  Check HTTP Method           │
              │  Is it idempotent?          │
              │  (GET/PUT/DELETE/HEAD/OPTIONS)│
              └──────────────┬───────────────┘
                             │
                    ┌────────┴────────┐
                    │                 │
                    ▼                 ▼
            ┌──────────────┐   ┌──────────────┐
            │   YES        │   │      NO      │
            │ Can Retry    │   │  No Retry    │
            │ (max 3)      │   │ (POST/PATCH) │
            └──────┬───────┘   └──────┬───────┘
                   │                  │
                   │                  │
                   ▼                  │
    ┌──────────────────────────┐     │
    │  Attempt 1: Immediate    │◄────┘
    │  (No connectivity check) │
    └──────────┬───────────────┘
               │
               ▼
    ┌──────────────────────┐
    │  Request Aborted?    │──YES──┐
    │  (via AbortSignal)   │       │
    └──────────┬───────────┘       │
               │NO                  │
               ▼                    │
    ┌──────────────────────┐       │
    │  Execute Request     │       │
    │  with Timeout (10s)  │       │
    └──────────┬───────────┘       │
               │                    │
               ▼                    │
    ┌──────────────────────┐       │
    │   Request Result     │       │
    └──────────┬───────────┘       │
               │                    │
      ┌────────┴────────┐           │
      │                 │           │
      ▼                 ▼           │
┌──────────┐    ┌────────────────┐ │
│ Success  │    │    Error       │ │
│ (2xx)    │    │                │ │
└────┬─────┘    └────┬───────────┘ │
     │               │             │
     │               ▼             │
     │    ┌──────────────────────┐ │
     │    │  Error Type?         │ │
     │    └──────┬───────────────┘ │
     │           │                 │
     │    ┌──────┴──────────┐      │
     │    │                 │      │
     │    ▼                 ▼      │
     │ ┌──────────┐  ┌──────────┐ │
     │ │Timeout   │  │Network   │ │
     │ │Offline   │  │5xx Error │ │
     │ │Cancelled │  │408/429   │ │
     │ └────┬─────┘  └────┬─────┘ │
     │      │             │        │
     │      ▼             │        │
     │ ┌──────────────┐   │        │
     │ │ NOT          │   │        │
     │ │ Retryable    │   │        │
     │ │ Return Error │   │        │
     │ └──────────────┘   │        │
     │                    │        │
     │                    ▼        │
     │         ┌────────────────┐  │
     │         │ Can Retry &    │  │
     │         │ Attempts Left? │  │
     │         └────┬───────┬───┘  │
     │              │       │      │
     │              NO      YES    │
     │              │       │      │
     │              ▼       │      │
     │         ┌──────────┐ │      │
     │         │ Return   │ │      │
     │         │ Error    │ │      │
     │         └──────────┘ │      │
     │                      │      │
     │                      ▼      │
     │              ┌──────────────────┐
     │              │ Check Offline?   │
     │              │ (NetInfo.fetch)  │
     │              └────┬─────────┬───┘
     │                   │         │
     │              Offline   Online
     │                   │         │
     │                   ▼         │
     │         ┌──────────────┐    │
     │         │ Return       │    │
     │         │ OfflineError │    │
     │         └──────────────┘    │
     │                             │
     │                             ▼
     │                  ┌────────────────────┐
     │                  │ Wait with          │
     │                  │ Exponential Backoff│
     │                  │ + Jitter           │
     │                  └──────┬─────────────┘
     │                         │
     │                         ▼
     │              ┌────────────────────────┐
     │              │ Attempt N: Retry       │
     │              │ (Loop back to Request  │
     │              │  Aborted? check)       │
     │              └────────────────────────┘
     │                         │
     │                         └──────┐
     │                                │
     ▼                                │
┌─────────────────┐                  │
│ Return Success  │                  │
│ Response        │                  │
└─────────────────┘                  │
                                     │
                                     ▼
                          ┌────────────────────┐
                          │ Return Cancelled   │
                          │ Error              │
                          └────────────────────┘
```

## Backoff Timing

```
Attempt 1:  Immediate
            │
            ▼
         [Request]
            │
         (Fails)
            │
            ▼
     ┌─────────────┐
     │ Wait ~1-1.5s│  (1000ms + 0-500ms jitter)
     └─────────────┘
            │
            ▼
Attempt 2:  [Request]
            │
         (Fails)
            │
            ▼
     ┌─────────────┐
     │ Wait ~2-2.5s│  (2000ms + 0-500ms jitter)
     └─────────────┘
            │
            ▼
Attempt 3:  [Request]
            │
         (Fails)
            │
            ▼
     ┌─────────────┐
     │ Wait ~4-4.5s│  (4000ms + 0-500ms jitter)
     └─────────────┘
            │
            ▼
Attempt 4:  [Request]
            │
         (Final)
            │
       ┌────┴────┐
       │         │
   Success    Failure
       │         │
       ▼         ▼
    Return    Return
    Success   Error
```

## Decision Tree: Should This Request Retry?

```
                    ┌─────────────────┐
                    │  HTTP Method?   │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
      ┌──────────────┐ ┌─────────┐ ┌──────────────┐
      │ GET/PUT/     │ │  POST/  │ │ HEAD/OPTIONS │
      │ DELETE       │ │  PATCH  │ │              │
      └──────┬───────┘ └────┬────┘ └──────┬───────┘
             │              │             │
             │              ▼             │
             │         ┌─────────┐        │
             │         │   NO    │        │
             │         │ Retry   │        │
             │         └─────────┘        │
             │                            │
             └──────────────┬─────────────┘
                            │
                            ▼
                   ┌─────────────────┐
                   │ retry: false?   │
                   └────────┬────────┘
                            │
                    ┌───────┴───────┐
                    │               │
                   YES             NO
                    │               │
                    ▼               ▼
              ┌─────────┐    ┌──────────────┐
              │   NO    │    │ Error Type?  │
              │ Retry   │    └──────┬───────┘
              └─────────┘           │
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
            ┌──────────────┐ ┌──────────┐ ┌──────────────┐
            │ Timeout/     │ │ 5xx/408/ │ │ 4xx Client   │
            │ Network      │ │ 429      │ │ Errors       │
            └──────┬───────┘ └────┬─────┘ └──────┬───────┘
                   │              │              │
                   ▼              ▼              ▼
            ┌──────────────┐ ┌─────────┐ ┌──────────────┐
            │ YES, Retry   │ │   YES   │ │    NO        │
            │ (if attempts │ │  Retry  │ │   Retry      │
            │  remaining)  │ │         │ │              │
            └──────────────┘ └─────────┘ └──────────────┘
```

## Error Handling Flow

```
┌─────────────────────────────────────────────┐
│              Error Occurs                   │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │   Error Instance?    │
        └──────────┬───────────┘
                   │
     ┌─────────────┼─────────────┐
     │             │             │
     ▼             ▼             ▼
┌──────────┐ ┌───────────┐ ┌──────────────┐
│Timeout   │ │Offline    │ │Network       │
│Error     │ │Error      │ │Error         │
└────┬─────┘ └─────┬─────┘ └──────┬───────┘
     │             │              │
     ▼             ▼              ▼
┌────────────────────────────────────────────┐
│         Normalize to ApiError              │
│ {                                          │
│   message: string,                         │
│   statusCode?: number,                     │
│   error: 'TimeoutError' | 'OfflineError' | │
│          'NetworkError' | string           │
│ }                                          │
└────────────────────────────────────────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │  Return ApiResponse  │
        │  { success: false,   │
        │    error: ApiError } │
        └──────────────────────┘
```

## State Machine: Request Lifecycle

```
     ┌──────────┐
     │  IDLE    │
     └────┬─────┘
          │ request()
          ▼
     ┌──────────┐
     │ PENDING  │──────┐ abort()
     └────┬─────┘      │
          │            │
          │ success    │
          ▼            ▼
     ┌──────────┐ ┌──────────┐
     │ SUCCESS  │ │CANCELLED │
     └──────────┘ └──────────┘
          │
          │ error & retryable
          ▼
     ┌──────────┐
     │ RETRYING │──────┐ abort()
     └────┬─────┘      │
          │            │
          │ backoff    │
          │ complete   │
          ▼            ▼
     ┌──────────┐ ┌──────────┐
     │ PENDING  │ │CANCELLED │
     └────┬─────┘ └──────────┘
          │
          │ max attempts
          │ or non-retryable
          ▼
     ┌──────────┐
     │  FAILED  │
     └──────────┘
```

## Timeline: Example Successful Retry Scenario

```
Time    Event
────────────────────────────────────────────────────────
0ms     GET /api/data initiated
        ├─ Method: GET (idempotent ✓)
        ├─ Retry enabled: true
        └─ Max attempts: 4

10ms    Request sent to server
        
5000ms  Response: 503 Service Unavailable
        ├─ Status: Retryable ✓
        ├─ Attempts remaining: 3
        └─ Calculate backoff: 1234ms

6234ms  Retry attempt 2 initiated
        ├─ Check NetInfo: Online ✓
        └─ Request sent

11234ms Response: 502 Bad Gateway
        ├─ Status: Retryable ✓
        ├─ Attempts remaining: 2
        └─ Calculate backoff: 2456ms

13690ms Retry attempt 3 initiated
        ├─ Check NetInfo: Online ✓
        └─ Request sent

14690ms Response: 200 OK
        ├─ Success! ✓
        └─ Return data to caller

Total elapsed: 14.69 seconds
Total attempts: 3
Result: SUCCESS
```

## Timeline: Example Offline Detection

```
Time    Event
────────────────────────────────────────────────────────
0ms     GET /api/data initiated
        └─ Max attempts: 4

10ms    Request sent to server
        
5000ms  Response: 503 Service Unavailable
        ├─ Status: Retryable ✓
        ├─ Attempts remaining: 3
        └─ Calculate backoff: 1234ms

5000ms  Device goes offline
        (User enters tunnel/airplane mode)

6234ms  Before retry attempt 2
        ├─ Check NetInfo: Offline ✗
        └─ Throw OfflineError

Total elapsed: 6.23 seconds
Total attempts: 1
Result: OfflineError (no retry wasted)
```

## Summary

### Key Decision Points
1. **Idempotency Check**: Is the HTTP method safe to retry?
2. **Error Type**: Is this a transient error worth retrying?
3. **Connectivity Check**: Is the device online before retrying?
4. **Attempts Remaining**: Have we exhausted our retry budget?
5. **Cancellation**: Has the user aborted the request?

### Safety Guarantees
- ✅ Non-idempotent operations never auto-retry
- ✅ Offline devices don't waste retry attempts
- ✅ Client errors (4xx) don't trigger retries
- ✅ Cancelled requests stop immediately
- ✅ Timeouts are enforced on every attempt
