# Pagination Contract

All list endpoints across the LumenPulse backend share the same pagination
contract. This document describes the query parameters, the response envelope,
and the cursor stability guarantees that clients can rely on.

## Query parameters

Every list endpoint accepts the following optional query parameters:

| Parameter  | Type | Default | Min | Max  | Description                          |
|-----------|------|---------|-----|------|--------------------------------------|
| `page`    | int  | 1       | 1   | —    | Page number (1-indexed)             |
| `pageSize`| int  | 20      | 1   | 100  | Number of items returned per page   |

The server enforces both the default and the maximum page size, so a client
that omits the parameters or requests an out-of-range value always receives a
bounded, stable response — unbounded list responses no longer exist.

Endpoints that need additional filters (e.g. `status`, `activityType`,
`sortOrder`) accept those alongside `page` / `pageSize` without changing the
pagination envelope.

## Response envelope

Every list endpoint returns the same JSON structure:

```json
{
  "items": [ ... ],
  "total": 42,
  "page": 1,
  "pageSize": 20,
  "totalPages": 3
}
```

| Field       | Type | Description                                           |
|-------------|------|-------------------------------------------------------|
| `items`     | array | Items for the current page                           |
| `total`     | int   | Total number of items matching the query            |
| `page`      | int   | Current page number (1-indexed)                      |
| `pageSize`  | int   | Effective page size (after server-side clamping)    |
| `totalPages`| int   | Total number of pages (always ≥ 1)                  |

This shape is generated as a named OpenAPI schema for every endpoint (e.g.
`RoundListResponseDto`, `ProjectListResponseDto`, …), so generated clients get
fully-typed response objects.

## Endpoints covered

| Endpoint                          | Schema                           |
|-----------------------------------|----------------------------------|
| `GET /grants/rounds`              | `RoundListResponseDto`          |
| `GET /projects`                   | `ProjectListResponseDto`        |
| `GET /news`                       | `NewsArticlesPaginatedResponseDto` |
| `GET /news/coin/:symbol`          | `NewsArticlesPaginatedResponseDto` |
| `GET /contributor-feed`           | `ContributorFeedResponseDto`    |
| `GET /search/projects`            | `ProjectSearchResponseDto`      |
| `GET /search/assets`              | `AssetSearchResponseDto`        |
| `GET /search/ecosystem`           | `EcosystemSearchResponseDto`    |
| `GET /exports`                     | `ExportJobListResponseDto`      |

## Cursor stability

Pagination uses a deterministic sort order (primary sort key + a unique
secondary key such as `id` or `createdAt`) so that pages are stable under
concurrent inserts. New rows inserted between two page requests appear on a
later page rather than shifting existing items, because the secondary sort key
ensures a total ordering.

The `total` field reflects the count at query time; clients that need a
real-time count should re-request page 1.

## Client integration

### Infinite scroll

1. Start with `page=1` and the desired `pageSize`.
2. Append each page's `items` to the list.
3. Stop when `page >= totalPages` or `items` is empty.

### Jump to page

```ts
const res = await fetch(`/v1/grants/rounds?page=${page}&pageSize=20`);
const { items, total, totalPages } = await res.json();
```
