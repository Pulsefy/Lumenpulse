# LumenPulse Threat Model

**Version**: 1.0.0  
**Last Updated**: 2026-08-26  
**Status**: Active

---

## Table of Contents

1. [Overview](#1-overview)
2. [Assets](#2-assets)
3. [Actors](#3-actors)
4. [System Architecture and Trust Boundaries](#4-system-architecture-and-trust-boundaries)
5. [Threat Analysis by Boundary](#5-threat-analysis-by-boundary)
6. [Key Handling — End to End](#6-key-handling--end-to-end)
7. [Accepted Risks](#7-accepted-risks)
8. [Vulnerability Reporting](#8-vulnerability-reporting)

---

## 1. Overview

LumenPulse is a decentralised crypto news aggregator and portfolio management platform built on the Stellar/Soroban blockchain. The system spans five layers:

- **Webapp** (Next.js) — browser-based UI
- **Mobile** (React Native / Expo) — iOS and Android client
- **Backend API** (NestJS) — REST API, auth, data aggregation
- **Data-Processing** (Python / FastAPI) — sentiment analysis, anomaly detection, ML pipelines
- **Contracts** (Soroban / Rust) — on-chain treasury, token, crowdfund vault, contributor registry, matching pool, protocol registry, yield vault

This document records what the system is defending against, where the trust boundaries are, what controls exist at each boundary, and which risks are explicitly accepted.

---

## 2. Assets

| Asset | Sensitivity | Notes |
|---|---|---|
| User password hashes | High | bcrypt-hashed in PostgreSQL |
| JWT access tokens | High | Short-lived; used to authorise every API call |
| JWT refresh tokens | High | 30-day lifetime; stored in `refresh_tokens` table; can be revoked |
| 2FA TOTP secrets | High | Stored encrypted in DB; used for optional second factor |
| Password reset tokens | High | 32-byte random; 1-hour TTL |
| `STELLAR_SERVER_SECRET` | Critical | Server-side Stellar keypair used for SEP-10-style wallet challenges |
| Contract admin keypairs | Critical | Control upgrades, treasury admin rotation, beneficiary rotation |
| `JWT_SECRET` | Critical | Signs all access and refresh tokens |
| `SOROBAN_INGEST_SECRET` | High | HMAC secret for Soroban event webhook ingestion |
| `WEBHOOK_SECRET` / `WEBHOOK_PROVIDERS` | High | HMAC/RSA/Ed25519 secrets for internal service webhooks |
| `PYTHON_API_KEY` | Medium | Shared secret between backend and data-processing service |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | High | S3 asset upload credentials |
| `TELEGRAM_BOT_TOKEN` | Medium | Alerting bot token |
| User wallet public keys | Low | Non-secret; cached in mobile SecureStore and DB |
| User wallet metadata (labels, linked account IDs) | Low | Non-secret; cached in mobile SecureStore |
| On-chain LUMEN tokens | High | Held in treasury, vesting wallet, and crowdfund vault contracts |
| User portfolio data | Medium | Financial positions and history in PostgreSQL |
| News/sentiment analytics | Low | Derived data; loss is recoverable |
| Soroban contract WASM hashes | Medium | Determine what code is running on-chain |

---

## 3. Actors

### Trusted

| Actor | Description |
|---|---|
| Authenticated user | Human who has completed email+password (+ optional 2FA) login and holds a valid JWT |
| Contract admin | Holder of the admin keypair registered in a Soroban contract |
| Backend service | The NestJS process; communicates with data-processing over an internal network using `PYTHON_API_KEY` |
| Data-processing service | The FastAPI process; authenticates inbound requests with `X-API-Key` |
| Soroban RPC relay | Trusted Stellar network endpoint |

### Partially Trusted

| Actor | Description |
|---|---|
| Webhook caller | An external or internal service that signs payloads with a shared secret or asymmetric key; treated as trusted only after signature verification and replay check |
| Wallet extension (Freighter / Lobstr) | Browser/mobile extension; trusted to sign transactions but not to hold secrets |

### Untrusted

| Actor | Description |
|---|---|
| Anonymous internet user | No credentials; can reach only public endpoints and health checks |
| Malicious external actor | Attempting injection, credential stuffing, replay, or contract exploits |
| Compromised device | Mobile device with physical or software access by an attacker |
| Malicious contract caller | Anyone attempting to call Soroban contracts without a valid admin address |

---

## 4. System Architecture and Trust Boundaries

The boundaries are numbered and referenced throughout Section 5.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  B1 — Public Internet → Webapp/Mobile                                    │
│  (HTTPS, CORS, no auth required for public routes)                       │
└────────────┬─────────────────────────────────────────────────────────────┘
             │
┌────────────▼─────────────────────────────────────────────────────────────┐
│  B2 — Webapp/Mobile → Backend API                                        │
│  (HTTPS, Bearer JWT, per-endpoint rate limits, CORS)                     │
└────────────┬─────────────────────────────────────────────────────────────┘
             │
     ┌───────┴──────────────────┐
     │                          │
┌────▼────────────┐   ┌─────────▼──────────────────────────────────────────┐
│  B3 — Backend   │   │  B5 — Backend API → Soroban / Stellar Horizon       │
│  API → Data-    │   │  (HTTPS to public RPC; no inbound auth from chain) │
│  Processing     │   └────────────────────────────────────────────────────┘
│  (X-API-Key)    │
└────┬────────────┘   ┌──────────────────────────────────────────────────┐
     │                │  B4 — External / Internal → Backend Webhooks     │
     │                │  (HMAC-SHA256/512, RSA-SHA256, Ed25519,          │
     │                │   timestamp replay guard)                        │
     │                └──────────────────────────────────────────────────┘
┌────▼─────────────────────────────────────────────────────────────────────┐
│  B6 — Any caller → Soroban Contracts                                     │
│  (Contract-level auth: require_auth(), admin checks, multisig, timelock) │
└──────────────────────────────────────────────────────────────────────────┘
```

### B1 — Public Internet → Webapp / Mobile

The webapp is a Next.js app served over HTTPS. The mobile app communicates only with the backend API. Neither exposes a server-side service directly to the internet beyond what Next.js renders/routes.

**Controls:**
- HTTPS enforced in all production deployments
- Next.js server components do not expose API secrets to the browser
- CORS configured per environment via `CORS_ORIGIN` env var (`apps/backend/.env.example`)

### B2 — Webapp / Mobile → Backend API

All authenticated API calls cross this boundary.

**Controls:**

| Control | Implementation |
|---|---|
| JWT authentication | `apps/backend/src/auth/jwt-auth.guard.ts` — `JwtAuthGuard` (Passport JWT strategy); validates signature and expiry on every request |
| RBAC | `apps/backend/src/auth/roles.guard.ts` — `RolesGuard` checks `UserRole` enum against `@Roles()` decorator |
| Contract admin RBAC + audit | `apps/backend/src/common/guards/contract-admin.guard.ts` — `ContractAdminGuard`; additionally writes every access decision to `AdminBlockchainAuditLog` via `ContractAdminAuditService` |
| Per-endpoint rate limiting | `apps/backend/src/common/rate-limit/rate-limit.guard.ts` + `rate-limit.config.ts`; Redis-backed; auth endpoints: 8 req/min, portfolio write: 10 req/min, search: 30 req/min, global: 120 req/min |
| Session revocation | `GET /auth/sessions`, `POST /auth/sessions/:id/revoke` — queries `refresh_tokens` table; sets `revokedAt`; only owner can revoke |
| 2FA (optional) | `apps/backend/src/auth/auth.service.ts` — speakeasy TOTP; QR code provisioning |
| Stellar wallet challenge | `auth.service.ts` — SEP-10-style nonce challenge signed by the client wallet; server keypair `STELLAR_SERVER_SECRET` |
| CORS | Configured in `CORS_ORIGIN`; enforced by NestJS CORS middleware |
| Refresh token rotation | 30-day TTL; stored hashed in `refresh_tokens` table; invalidated on logout or revocation |
| Password hashing | bcrypt, 10 rounds (`AuthService.BCRYPT_SALT_ROUNDS`) |
| Password reset | 32-byte random token, 1-hour TTL (`apps/backend/src/auth/entities/password-reset-token.entity.ts`) |

### B3 — Backend API → Data-Processing Service

The NestJS backend calls the Python FastAPI service for sentiment analysis and ML features. The data-processing service treats the backend as a trusted caller but still requires authentication.

**Controls:**

| Control | Implementation |
|---|---|
| API key header auth | `apps/data-processing/src/security.py` — `SecurityConfig.validate_api_key()`; checks `X-API-Key` header against `API_KEY` env var; returns 401 if missing, 403 if wrong |
| Rate limiting (inbound) | `security.py` — slowapi `Limiter`; default 100 req/min, strict 10 req/min; **currently uses in-memory storage — must be Redis in production** (see [Accepted Risks](#7-accepted-risks)) |
| Path exclusions | Health (`/health`), metrics (`/metrics`), docs (`/docs`, `/redoc`, `/openapi.json`), and `/sentiment/legend` skip API key check |

### B4 — External / Internal → Backend Webhooks

Soroban event ingestion and third-party integrations POST signed payloads to the backend.

**Controls:**

| Control | Implementation |
|---|---|
| HMAC-SHA256 signature | `apps/backend/src/webhook/` + `WEBHOOK_VERIFICATION_FRAMEWORK.md`; `X-Webhook-Signature: sha256=<hex>` |
| HMAC-SHA512 | As above with `sha512=<hex>` |
| RSA-SHA256 | Public-key verification; `X-Webhook-Signature: rsa256=<base64>` |
| Ed25519 | Public-key verification; `X-Webhook-Signature: ed25519=<base64>` |
| Replay protection | `X-Webhook-Timestamp` header; tolerance window 300 seconds (`SOROBAN_TIMESTAMP_TOLERANCE_MS`); constant-time comparison |
| IP allowlisting | Optional `allowedIps` per provider config |
| Soroban ingest HMAC | `SOROBAN_INGEST_SECRET` env var; separate from general webhook secrets |

### B5 — Backend API → Stellar / Soroban RPC

The backend queries Stellar Horizon and the Soroban RPC for chain data. This boundary is outbound-only from the backend's perspective; the blockchain does not authenticate the backend's read queries.

**Controls:**

| Control | Implementation |
|---|---|
| HTTPS to public endpoints | `STELLAR_HORIZON_URL`, `STELLAR_SOROBAN_RPC_URL` in env |
| Server keypair isolation | `STELLAR_SERVER_SECRET` is only used for generating wallet auth challenges; it does not sign financial transactions |
| Retry/timeout | `STELLAR_TIMEOUT=30000`, `STELLAR_RETRY_ATTEMPTS=3` |

### B6 — Any Caller → Soroban Contracts

Soroban contracts enforce access control at the protocol layer, independent of the backend.

**Controls:**

| Control | Contract | Implementation |
|---|---|---|
| Admin `require_auth()` | `upgradable-contract`, `treasury`, `lumen_token` | `admin.require_auth()` enforced by Soroban SDK; fails if caller's signature is absent |
| 24-hour operation timelock | `upgradable-contract/src/lib.rs` | `queue_operation()` sets `execute_after = now + MIN_DELAY_SECONDS` (86400 s); `execute_operation()` panics if `now < execute_after` |
| Direct upgrade fallback | `upgradable-contract/src/lib.rs` | `upgrade()` and `set_admin()` remain for backwards compatibility; these bypass the timelock — see [Accepted Risks](#7-accepted-risks) |
| Multisig for admin rotation | `treasury/src/multisig.rs` | `consume_approval()` checks proposal has sufficient signatures and correct `ProposalAction` before executing `set_admin_via_multisig()` or `rotate_beneficiary_via_multisig()` |
| Reentrancy guard | `treasury/src/lib.rs` | `with_reentrancy_guard()` wraps `allocate_budget`, `claim`, `rotate_beneficiary`, `rotate_beneficiary_via_multisig`; uses cross-contract `reentrancy-guard` contract |
| Idempotency guard | `treasury/src/lib.rs` — `allocate_budget()` | `idempotency_guard::claim_request()` prevents duplicate budget allocations with the same `request_id` |
| Token admin freeze | `lumen_token/src/lib.rs` | Admin can call `freeze()` to halt token transfers |
| Already-initialized guard | `upgradable-contract`, `treasury` | `init()`/`initialize()` panic if storage key `Admin` is already set |

---

## 5. Threat Analysis by Boundary

### B1 — Public Internet → Webapp / Mobile

| Threat | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Credential stuffing against login endpoint | High | High | Rate limit: 8 req/min for auth endpoints (Redis-backed); bcrypt hashing slows offline cracking |
| Phishing / session hijacking (webapp) | Medium | High | Short JWT TTL; session revocation via Security Center; 2FA option |
| Phishing / token theft (mobile) | Medium | High | Tokens stored in `expo-secure-store` (hardware-backed on supported devices); biometric lock guards app access |
| Path enumeration / scanner noise | Low | Low | Non-existent routes return 404; no stack traces in production |

### B2 — Webapp / Mobile → Backend API

| Threat | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Stolen JWT used from attacker's device | Medium | High | Short access token TTL; session revocation; `isCurrent` flag in session list (partial — see [Accepted Risks](#7-accepted-risks)) |
| Privilege escalation via role manipulation | Low | Critical | `RolesGuard` reads role from validated JWT payload, not request body; roles set only by admin-controlled DB write |
| Contract admin endpoint abuse | Low | Critical | `ContractAdminGuard`: requires `ADMIN` role; every access attempt (granted or denied) is written to `AdminBlockchainAuditLog` |
| Replay of authenticated requests | Low | Medium | Idempotency interceptor on write endpoints; stateless JWT contains `iat`/`exp` — not a full replay shield on its own |
| Brute-force password reset | Medium | Medium | `POST /auth/forgot-password` rate-limited; token is 32 random bytes with 1-hour TTL |
| 2FA bypass | Low | High | TOTP enforced server-side if enabled; recovery path not hardened beyond email reset (see [Accepted Risks](#7-accepted-risks)) |

### B3 — Backend → Data-Processing

| Threat | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Unauthenticated access to ML/analytics endpoints | Low | Medium | `X-API-Key` middleware in `security.py`; 401/403 on missing/invalid key |
| Key leakage via environment | Low | Medium | `PYTHON_API_KEY` injected via platform secrets; not committed to repo |
| Rate-limit saturation (in-memory) | Medium | Medium | **Accepted risk** — see Section 7; in-memory limiter resets on process restart |
| Sensitive data exfiltration via exposed docs | Low | Low | `/docs`, `/redoc`, `/openapi.json` excluded from API key requirement — these pages describe the API but contain no user data |

### B4 — Webhooks

| Threat | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Forged webhook payload | Medium | High | Signature verification required; constant-time HMAC comparison prevents timing attacks |
| Replay of old webhook | Medium | Medium | 300-second timestamp tolerance window enforced |
| Secret rotation disruption | Low | Medium | Runtime provider management: `PUT /webhooks/admin/providers/:name` allows key rotation without restart |

### B5 — Backend → Blockchain

| Threat | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Soroban RPC unavailability | Medium | Medium | Retry with configurable attempts and delay; health endpoint monitors RPC latency |
| Man-in-the-middle on RPC calls | Low | High | HTTPS to official Stellar endpoints; pinning not implemented (see [Accepted Risks](#7-accepted-risks)) |
| Server keypair compromise | Low | Critical | Only used for challenge generation; not used to sign financial transactions; stored only in env — see Section 6 |

### B6 — Contracts

| Threat | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Admin key compromise leading to unauthorized upgrade | Low | Critical | 24-hour timelock gives a window to detect and cancel; multisig required for treasury admin rotation |
| Reentrancy on token transfer | Low | Critical | `reentrancy-guard` contract wraps all cross-contract token operations in treasury |
| Duplicate budget allocation | Low | High | `idempotency_guard::claim_request()` rejects repeated `request_id` |
| Beneficiary address hijacking | Low | High | `rotate_beneficiary` requires admin auth; via-multisig variant requires proposal approval |
| Front-running on timelock | Low | Medium | Stellar's deterministic ledger order reduces front-running opportunity; operations are cancelled by admin if suspicious |
| Direct upgrade bypassing timelock | Medium | High | `upgrade()` function retained for backwards compatibility but bypasses delay — see [Accepted Risks](#7-accepted-risks) |

---

## 6. Key Handling — End to End

### 6.1 User Wallet Credentials

| Step | What happens | Where |
|---|---|---|
| Key generation | Wallet extension (Freighter / Lobstr) generates and holds the user's Stellar keypair. The private key **never leaves the extension or device**. | Client device |
| Wallet auth challenge | Backend issues a Soroban-style challenge transaction (nonce + server pubkey). Client wallet signs it. Backend verifies the signature. | `apps/backend/src/auth/auth.service.ts` |
| Token storage (mobile) | Access token and refresh token written to `expo-secure-store` under hardware-backed encryption. | `apps/mobile/lib/storage.ts` |
| Token storage (webapp) | Tokens held in memory / secure cookie; not persisted to `localStorage`. | `apps/webapp/lib/auth-service.ts` |
| Legacy migration | Any `auth_token`, `refresh_token`, `token`, `user` keys found in `AsyncStorage` are migrated to `SecureStore` and deleted from `AsyncStorage` on first load. | `apps/mobile/lib/storage.ts` — `migrateLegacyTokens()` |
| Wallet metadata (mobile) | Only non-secret metadata stored (public key, label, account ID). Never the private key. | `apps/mobile/lib/storage.ts` — `WALLET_METADATA_KEY` |
| Biometric lock | Optional; `expo-local-authentication` gates app open on enrolled biometric or device passcode. | `apps/mobile/lib/biometric-lock.ts`, `apps/mobile/components/BiometricLockGuard.tsx` |
| Logout | `clearAuthState()` deletes `auth_token`, `refresh_token`, and `wallet_metadata` from `SecureStore` and removes legacy `AsyncStorage` keys. Server-side refresh token is revoked. | `apps/mobile/lib/storage.ts` |

### 6.2 Service API Keys

| Key | Purpose | Storage at rest | Rotation procedure |
|---|---|---|---|
| `JWT_SECRET` | Signs all JWT tokens | Platform secret manager / env injection | Rotate in env; existing tokens become invalid immediately; users re-login |
| `STELLAR_SERVER_SECRET` | SEP-10-style wallet challenge signing | Platform secret manager / env injection | Rotate in env; outstanding challenges (5-minute TTL) expire naturally |
| `PYTHON_API_KEY` | Backend → data-processing auth | Both services' env; never in source code | Rotate simultaneously in both services; brief downtime if not done atomically |
| `SOROBAN_INGEST_SECRET` | Webhook HMAC for Soroban event ingestion | Backend env | Rotate via runtime provider API or env restart |
| `WEBHOOK_SECRET` / `WEBHOOK_PROVIDERS` secrets | Service-to-service webhook auth | Backend env | Rotate via `PUT /webhooks/admin/providers/:name` without restart |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | S3 asset uploads | Backend env | Rotate in AWS IAM; update env |
| `DB_PASSWORD` | PostgreSQL access | Backend env | Rotate in DB; update env; rolling restart |

### 6.3 Contract Admin Keys

| Key | Purpose | Controls | Rotation procedure |
|---|---|---|---|
| `upgradable-contract` admin | Authorises `queue_operation`, `execute_operation`, `cancel_operation`; also legacy `upgrade()` and `set_admin()` | `require_auth()` enforced by Soroban; 24-hour timelock on timelocked path | Call `queue_operation` with `TimelockAction::SetAdmin(new_admin)`; wait 24 hours; call `execute_operation`. Or use legacy `set_admin()` immediately (bypasses timelock — see [Accepted Risks](#7-accepted-risks)). |
| Treasury admin | Authorises `allocate_budget`, `cancel_stream`, `emergency_stop`, `rotate_beneficiary` | `require_auth()` + admin address check in contract; multisig required for `set_admin_via_multisig` | Propose `SetAdmin` action via `propose()`; gather signatures from multisig signers; call `set_admin_via_multisig()` |
| Lumen token admin | Authorises `freeze()` and contract upgrade | `require_auth()` + admin check in `admin.rs` | Call `set_admin()` with current admin auth |
| Backend `ContractAdmin` role | Allows calling contract admin endpoints via REST API | `ContractAdminGuard`: RBAC check + audit log in `AdminBlockchainAuditLog` | Promote/demote users via `UserRole` in DB; `ContractAdminGuard` enforces at runtime |

---

## 7. Accepted Risks

The following risks are known and explicitly accepted. Each has a rationale and a remediation path.

---

**AR-1: Data-processing rate limiter uses in-memory storage**

- **Risk**: The slowapi rate limiter in `apps/data-processing/src/security.py` is configured with `storage_uri="memory://"`. On process restart, all rate-limit counters reset, allowing burst traffic immediately after a restart. In multi-process deployments the limit is not shared.
- **Accepted because**: The data-processing service is currently a single-process internal service, not directly reachable from the internet.
- **Remediation**: Change `storage_uri` to `redis://` (e.g. `REDIS_URL`) before exposing the service to untrusted callers or running multiple workers.
- **Code reference**: `apps/data-processing/src/security.py`, `SecurityConfig.limiter` method.

---

**AR-2: `upgrade()` and `set_admin()` in upgradable-contract bypass the 24-hour timelock**

- **Risk**: The `upgrade()` and `set_admin()` functions in `apps/onchain/contracts/upgradable-contract/src/lib.rs` perform immediate operations without queuing. A compromised admin key can upgrade the contract or transfer admin rights instantly.
- **Accepted because**: These functions were retained for backwards compatibility with existing tests. The timelocked path (`queue_operation` / `execute_operation`) is the intended production flow.
- **Remediation**: Remove or gate the direct functions behind a multi-sig or a second admin key before mainnet deployment. Document clearly in the contract's own README that `upgrade()` is deprecated.

---

**AR-3: `isCurrent` session flag is always `false`**

- **Risk**: The `GET /auth/sessions` response sets `isCurrent: false` for all sessions, so users cannot reliably identify and revoke their own active session from the Security Center.
- **Accepted because**: Accurately marking the current session requires embedding a session identifier in the JWT payload, which is a follow-on task.
- **Remediation**: Add a `sessionId` claim to the JWT at issuance; match it against the `refresh_tokens` table to set `isCurrent` correctly.
- **Code reference**: `apps/backend/src/auth/dto/session.dto.ts`, `apps/backend/SECURITY_CENTER_PR.md`.

---

**AR-4: No TLS certificate pinning on Stellar RPC calls**

- **Risk**: The backend communicates with Stellar Horizon and the Soroban RPC over HTTPS but does not pin TLS certificates. A compromised CA could issue a fraudulent certificate.
- **Accepted because**: Certificate pinning introduces operational burden (key rotation) and the risk of pinning the wrong certificate. The official Stellar endpoints are operated by Stellar Development Foundation.
- **Remediation**: If deploying in high-assurance environments, consider certificate pinning or using a private Soroban node with a well-known CA-signed certificate.

---

**AR-5: 2FA recovery path is email-based**

- **Risk**: If a user's 2FA device is lost, recovery falls back to the password-reset email flow. An attacker who controls the user's email account can bypass 2FA.
- **Accepted because**: Providing recovery codes or backup methods adds UX and implementation complexity not yet prioritised.
- **Remediation**: Implement backup recovery codes at 2FA enrolment time, stored hashed in the DB.

---

**AR-6: Webhook admin endpoints for provider management are not behind a separate authentication layer**

- **Risk**: `GET/POST/PUT/DELETE /webhooks/admin/providers` — these endpoints manage webhook secrets at runtime. If an attacker holds a valid `ADMIN` JWT, they can register or overwrite provider secrets.
- **Accepted because**: Admin JWT is already a high-privilege credential; these endpoints require `ADMIN` role enforced by `ContractAdminGuard` with audit logging.
- **Remediation**: Consider requiring a separate `webhook-admin` role, or requiring step-up 2FA confirmation for secret-management actions.

---

## 8. Vulnerability Reporting

### Contact

If you discover a security vulnerability in LumenPulse, please report it **privately** before public disclosure.

- **Primary contact**: Open a [GitHub Security Advisory](https://github.com/Pulsefy/Lumenpulse/security/advisories/new) on the upstream repository (`Pulsefy/Lumenpulse`). This is the preferred channel; it keeps the report confidential until a fix is released.
- **Community**: Join the [LumenPulse Discord](https://discord.gg/gBmApTNVV) and DM **@pulsefy** for urgent issues.

### Scope

In scope:
- Authentication and authorisation bypasses (backend API, contracts)
- Key exposure or exfiltration
- Smart contract exploits (reentrancy, admin bypass, fund drainage)
- Mobile token storage issues
- Server-side injection (SQL, command, template)
- Cryptographic weaknesses (weak algorithms, improper key sizes)

Out of scope:
- Issues requiring physical access to a user's unlocked device
- Denial-of-service attacks against third-party Stellar/Horizon infrastructure
- Social engineering of team members
- Theoretical vulnerabilities with no demonstrated impact

### Response SLA

| Severity | First response | Fix target |
|---|---|---|
| Critical (fund loss, admin key exposure) | 24 hours | 72 hours |
| High (auth bypass, data breach) | 48 hours | 7 days |
| Medium / Low | 5 business days | Next release cycle |

### Responsible Disclosure

We ask reporters to:
1. Not exploit vulnerabilities beyond proof-of-concept.
2. Not share details publicly until a fix is released or 90 days have elapsed, whichever comes first.
3. Include a description of the vulnerability, steps to reproduce, and an assessment of impact.

We will credit researchers in the release notes unless they prefer to remain anonymous.
