# feat(ingestion): harden ingestion layer and implement Keeper identity

## Summary

Closes #33

This PR implements a robust ingestion layer to handle flaky API responses and rate limits, and introduces secure identity management for the 'Keeper' account responsible for signing and submitting transactions.

## What was implemented

### 1. Robust HTTP Client (`src/utils/http_client.py`)
- **Exponential Backoff**: Integrated `tenacity` for retries with exponential wait times (2s to 10s).
- **Circuit Breaker**: Integrated `pybreaker` to instantly fail requests when a service is persistently down, preventing resource exhaustion.
- **Rate Limit Handling**: Specific handling for HTTP 429 status codes, including support for the `Retry-After` header.
- **Structured Logging**: All HTTP requests now log status codes, durations, and helpful context for debugging.

### 2. Keeper Identity Management (`src/utils/keeper.py`)
- **Secure Loading**: Implemented loading of the signing keypair from the `KEEPER_SECRET` environment variable.
- **On-chain Validation**: Automatic verification that the Keeper account exists on the Stellar network.
- **Balance Verification**: Checks that the account holds a minimum of 5 XLM to cover potential transaction fees before allowing the service to start.
- **Startup Integration**: Integrated identity checks into `main.py` so the service fails fast if the identity is misconfigured or invalid.

## Technical details

- **`tenacity` Library**: Used for declarative retry logic, allowing for easy configuration of stop/wait conditions without nesting `try-except` blocks.
- **`pybreaker` Library**: Implements the State Pattern for circuit breaking (Closed -> Open -> Half-Open).
- **Stellar SDK**: Utilized `Keypair` for cryptographic operations and `Server.accounts()` for balance verification.

## How it was tested

- **Manual Verification**: Created `demo_http_robustness.py` to simulate network failures, rate limits, and circuit trips.
- **Unit Tests**:
  - `tests/unit/test_http_client.py`: Verified retries, backoff, and circuit breaker states.
  - `tests/unit/test_keeper.py`: Verified identity loading and on-chain validation logic (using mocks).
  - `tests/test_news_fetcher.py`: Verified refactored `NewsFetcher` against existing test cases.
- **All tests passed (16/16)**.

## Checklist

- [x] Code follows project naming conventions
- [x] Unit tests cover new robustness logic
- [x] Manual demo script provided for verification
- [x] `.env.example` updated with new configuration
- [x] Integrated into main startup flow
