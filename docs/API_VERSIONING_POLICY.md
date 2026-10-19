# API Versioning Policy

This document defines the versioning strategy, lifecycle management, and backward compatibility guarantees for the LumenPulse REST API.

---

## 1. Versioning Scheme

LumenPulse uses **URI Path Versioning** for all external and internal API contracts:

```
https://api.lumenpulse.io/v1/...
```

- The current stable production API version is **`v1`**.
- Major version increments (`v1` → `v2`) indicate breaking contract modifications.
- Minor and patch evolutions are additive, backward-compatible, and do not increment the URI version path.

---

## 2. When a Change Requires a New Version (`v2`)

A change is classified as **breaking** and requires introducing a new API major version (`v2`) if any of the following occur:

1. **Endpoint Removal or Renaming**:
   - Deleting an existing route.
   - Changing the HTTP method for an existing route (e.g. `POST` changed to `PUT`).
   - Renaming the URL path of an existing resource.

2. **Request Contract Breaking Changes**:
   - Adding a required request property, query parameter, or header that previous clients did not provide.
   - Renaming or removing an existing request parameter or field.
   - Restricting valid value domains (e.g. changing an enum to exclude previous options, or tightening validation constraints).
   - Altering the expected data type of a request field (e.g. `string` changed to `number` or `array`).

3. **Response Contract Breaking Changes**:
   - Renaming or deleting fields in an established response DTO.
   - Changing the data type of an existing response field.
   - Changing response envelopes (e.g. changing `{ data: [...] }` to a different container shape).
   - Changing the semantics or schema of error envelopes (`code`, `message`, `details`).

4. **Authentication & Authorization Changes**:
   - Introducing mandatory authentication to previously public endpoints.
   - Changing the cryptographic signature scheme or header structure without fallback.

---

## 3. Non-Breaking Changes (Allowed within `v1`)

The following additive changes do **not** require a new version and are released within the current `v1` surface:

- Adding new endpoints / resources.
- Adding optional request fields or query parameters with sensible defaults.
- Adding new fields to response payloads (consumers are expected to ignore unknown properties).
- Performance improvements, bug fixes, internal query optimizations, and rate limit adjustments.
- Adding non-breaking HTTP response headers.

---

## 4. Deprecation & Sunset Lifecycle (RFC 8594)

When an unversioned route or deprecated version is scheduled for retirement:

1. **Grace Period**:
   - A minimum **6-month transition period** is guaranteed before an unversioned or deprecated route is terminated.
   - Current sunset target for unversioned routes: **April 19, 2027**.

2. **Standard Deprecation Headers**:
   During the transition window, requests served via fallback or marked deprecated will return:
   - `Deprecation: true` (per RFC 8594)
   - `Sunset: <HTTP-Date>` indicating the retirement deadline.
   - `Link: </v1/...>; rel="successor-version"` providing the path to the current version.

3. **Telemetry & Monitoring**:
   - Fallback usage is monitored via Prometheus metrics (`http_unversioned_requests_total`) and logged with deprecation warnings to identify outdated clients.

---

## 5. Client Guidelines

All client applications (Webapp, Mobile, Python data-processing service, and external SDKs) MUST target explicit version prefixes:

- Webapp: Ensure `NEXT_PUBLIC_API_URL` or client requests route to `/v1`.
- Mobile: `EnvironmentConfig.apiBaseUrl` points to `/v1` or delegates to versioned endpoints.
- Python Services: `BACKEND_URL` points to `/v1` or requests `/v1/...`.
