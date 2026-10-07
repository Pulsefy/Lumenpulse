# Pagination

Every list endpoint in the LumenPulse backend shares **one pagination
contract**. This document is the client-facing specification; the same content
is summarized in the OpenAPI/Swagger output at `GET /api/docs`.

## Query parameters

| Parameter | Type   | Default | Max    | Description |
| --------- | ------ | ------- | ------ | ----------- |
| `page`    | int ≥1 | `1`     | —      | 1-based page number for **offset** endpoints. Ignored by cursor endpoints. |
| `limit`   | int 1–100 | `20` | `100`  | Items per page. Applied by every list endpoint. Requests outside the range fail with `400 Bad Request`. |
| `cursor`  | string | —       | 255 ch | Opaque token from a previous response's `meta.nextCursor`, for **cursor** endpoints. Ignored by offset endpoints. |

The same three parameters are accepted everywhere; each endpoint uses the pair
that matches its data source and ignores the other.

## Response metadata

Every paginated response includes an identical `meta` object:

```json
{
  "meta": {
    "limit": 20,
    "page": 1,
    "total": 150,
    "totalPages": 8,
    "nextCursor": null
  }
}
```

| Field        | Type            | Meaning |
| ------------ | --------------- | ------- |
| `limit`      | number          | Page size actually applied to the response. |
| `page`       | number \| null  | Current 1-based page; `null` on cursor endpoints. |
| `total`      | number \| null  | Total items across all pages; `null` when the data source cannot report one (external providers). |
| `totalPages` | number \| null  | `ceil(total / limit)`; `null` when `total` is unknown. |
| `nextCursor` | string \| null  | Cursor for the next page on cursor endpoints; `null` on offset endpoints or when there are no further pages. |

Item arrays keep their endpoint-specific names (`users`, `items`, `snapshots`,
`transactions`, `articles`, `categories`, `sessions`, `assets`); only the
metadata object is uniform.

## Offset mode vs cursor mode

- **Offset mode** — database-backed lists ordered with a stable secondary key
  (unique `id` tiebreak), so consecutive pages never overlap or skip rows even
  when records are inserted concurrently. Walk pages with `page=1,2,3…`.
- **Cursor mode** — lists backed by Stellar Horizon, which paginates by record
  paging token. Fetch page 1 without a cursor, then pass `meta.nextCursor` to
  continue. Cursor walks are inherently stable: a record inserted between two
  requests appears at the head of a refreshed walk and never shifts, duplicates,
  or drops records the client has already paged past.

## Endpoint matrix

| Endpoint | Mode | Notes |
| -------- | ---- | ----- |
| `GET /users` | offset | Ordered `createdAt DESC, id ASC`. |
| `GET /watchlist` | offset | Ordered `sortOrder ASC, createdAt DESC, id ASC`; `type` filter preserved. |
| `GET /portfolio/history` | offset | Ordered `createdAt DESC, id ASC`. Legacy flat `page`/`limit`/`totalPages` fields retained. |
| `GET /news` | offset | `tag`/`category` filters query the database (known total). Without filters the upstream provider is used and `meta.total` is `null`; the provider window is capped at `limit × page ≤ 100`, so deeper pages return an empty list. |
| `GET /news/search` | offset | Provider-backed; `meta.total` is `null`. Same window cap as `GET /news`. |
| `GET /news/coin/:symbol` | offset | Provider-backed; `meta.total` is `null`. Same window cap as `GET /news`. |
| `GET /news/categories` | offset | Provider returns the full list in one call, so pages and `meta.total` are exact. |
| `GET /auth/sessions` | offset | Ordered `createdAt DESC, id ASC`. |
| `GET /transactions/history` | cursor | Horizon-backed; `meta.nextCursor` continues the walk. Legacy `nextPage`/`total` fields retained. |
| `GET /transactions/account/:publicKey` | cursor | Same contract as `/transactions/history`. |
| `GET /stellar/transactions` | cursor | Same contract as `/transactions/history`; requires `publicKey`. |
| `GET /stellar/assets` | cursor | Horizon asset records; legacy `nextCursor`/`hasMore` fields retained. |

## Intentionally not paginated

- `GET /users/me/accounts` — hard-capped server-side at 10 linked accounts.
- `GET /analytics/chart-data` — bounded by design (`7d`/`30d` range × `1h`/`1d`
  interval, ≤ 720 buckets).
- Aggregate/singleton responses (`/portfolio/summary`, `/portfolio/allocation`,
  `/portfolio/performance`, `/news/sentiment-summary`, `/metrics`, health checks)
  — not collections of records.
- Development-only endpoints under `/test*` and `/test-exception*`.

## Client recommendations

1. Read `meta` rather than endpoint-specific fields when deciding whether more
   data exists: offset endpoints → `meta.totalPages`; cursor endpoints →
   `meta.nextCursor !== null`.
2. Treat `limit` as a hint: the server enforces the default (20) and maximum
   (100) for you.
3. Handle `null` metadata fields gracefully — external data sources cannot
   report totals.
4. On `400` with the standard validation error body, check `details[]` for the
   offending `page`/`limit`/`cursor` field.
