# API Versioning and Deprecation Strategy

## Overview

LumenPulse uses **URI-based versioning** (`/v1/`, `/v2/`, etc.) powered by
NestJS's built-in versioning support. This document defines how contributors
introduce new versions and deprecate old ones without breaking existing clients.

---

## Versioning Approach

URI versioning is enabled in `main.ts`:

```typescript
app.enableVersioning({ type: VersioningType.URI });
```

All routes are prefixed automatically:

| Version | Example URL |
|---------|-------------|
| v1 | `/v1/portfolio` |
| v2 | `/v2/portfolio` |

### Defining a versioned controller

```typescript
@Controller({ path: 'portfolio', version: '2' })
export class PortfolioV2Controller { ... }
```

### Defining a versioned route

```typescript
@Version('2')
@Get()
findAll() { ... }
```

---

## Deprecation Strategy

### Three-phase lifecycle