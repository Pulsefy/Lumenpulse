# Personal Data Policy — Data-Processing Ingestion

**Issue:** #1452 — *Data-processing: Scrub personal data at ingestion*
**Code:** `apps/data-processing/src/privacy/scrubbing.py`
**Cross-referenced from:** [Threat Model](threat-model.md) — boundary **B7 (External Data Sources → Data-Processing)**, sections 4 and 5.

---

## 1. Scope

This policy governs personal data that reaches `apps/data-processing` through
untrusted free text:

- news articles fetched from third-party APIs,
- social posts (Twitter/Reddit) fetched from third-party APIs,
- text submitted to the prediction/analysis API endpoints.

**Out of scope:** on-chain ledger records (contract events, account
operations, project contributors). Those are public blockchain data read from
Stellar Horizon / Soroban RPC; every address appearing there is already public
by design and is handled by the on-chain data-quality rules, not by this
policy.

## 2. Field inventory (acceptance criterion 1)

The inventory is declared in code as `PERSONAL_DATA_INVENTORY`
(`src/privacy/scrubbing.py`) and is the authoritative list. Tests assert that
every row carries a valid treatment.

| Field | Records | Personal data | Treatment |
|---|---|---|---|
| `title` | news article | Contact details or wallet addresses quoted in the headline | text scrub |
| `content` | news article, social post | E-mails, phone numbers, IPs, social handles, wallet addresses | text scrub |
| `summary` | news article | Same free-text exposure as `content` | text scrub |
| `author` | social post | Platform username / handle of the poster | identifier → `[AUTHOR]` |
| `url` | news article, social post | E-mails, IP hosts or account identifiers in links/query strings | text scrub |
| `hashtags` | social post | Handle-style labels copied from the post | text scrub |
| `tags` | news article | Free-text tags copied from the source feed | text scrub |
| `keywords` | derived article tags | Derived from source text (scrubbed first) | text scrub |
| `detected_entities` | derived article tags | Extracted from source text (scrubbed first) | text scrub |
| `input_text` | prediction log | Caller-supplied text analysed by the model | text scrub |
| `raw_input` | prediction log | Stored copy of the request text (only when `LOG_PREDICTION_RAW_INPUT=true`) | text scrub |

**Structural fields** (`STRUCTURAL_FIELDS`: `id`, `article_id`, `post_id`,
`request_id`, `platform`, `source`, `published_at`, `posted_at`, timestamps,
asset labels, …) are exempt: they are identifiers or labels and cannot carry
personal data; keeping them intact preserves record identity and ordering.

**Unknown fields are scrubbed as free text by default**, so a newly added
field is covered until it is explicitly classified. `scrub_record()` raises
`TypeError` for non-mapping input rather than silently passing data through.

### Redaction patterns

| Pattern | Placeholder |
|---|---|
| E-mail address | `[EMAIL]` |
| SSN (`ddd-dd-dddd`) | `[SSN]` |
| Credit card number (16 digits, space/dash separated) | `[CREDIT_CARD]` |
| Phone number (international and common national formats) | `[PHONE]` |
| IPv4 address | `[IP_ADDRESS]` |
| Social handle (`@name`) | `[HANDLE]` |
| Wallet address (Stellar `G…`, EVM `0x…`) | `[WALLET_ADDRESS]` — policy-dependent, see §4 |
| Author/user field | `[AUTHOR]` |

Order matters: e-mail before handles, SSN/card before phone numbers. Scrubbing
is idempotent — placeholders never re-match the patterns, so the stage can run
at more than one boundary without double-processing.

## 3. Enforcement stages (acceptance criterion 2)

The stage runs at **every boundary a record crosses**, so it happens **before
persistence and before feature computation**:

| Stage | Where | Why |
|---|---|---|
| Ingestion | `src/ingestion/news_fetcher.py` (`fetch_latest`), `src/ingestion/social_fetcher.py` (`fetch_all`), `src/fetchers.py` (`fetch_all_news`) | Feature computation (sentiment, NER, keywords, embeddings) reads the fetched record directly — scrubbing must happen first |
| Persistence | `src/db/postgres_service.py` — `save_article`, `save_articles_batch`, `save_social_post`, `save_social_posts_batch`, `save_news_insight`, `save_news_insights_batch` | Defence in depth: covers `scripts/backfill.py` and any other writer that does not go through the fetchers |
| Prediction logging | `src/api/server.py` — `_log_prediction` | Request logging follows the same rules, see §5 |

Feature-computation consumers (`src/ml/feature_store.py`,
`src/ml/retraining_pipeline.py`, NER/keyword/embedding generation) only ever
see scrubbed input because they read from the scrubbed record or from a
scrubbed database row.

## 4. Wallet address policy (acceptance criterion 3)

Wallet addresses are **not** treated by an implicit default. The policy is
explicit and configurable:

| Variable | Values | Default |
|---|---|---|
| `PRIVACY_WALLET_ADDRESS_POLICY` | `mask` \| `retain` | `mask` |

- **`mask`** (default) — Stellar (`G` + 55 characters) and EVM (`0x` + 40 hex)
  addresses inside free text are replaced with `[WALLET_ADDRESS]`.
- **`retain`** — wallet addresses are kept verbatim; all other personal data
  patterns are still scrubbed.

An unknown value raises `ValueError` from `get_wallet_address_policy()` — a
misconfigured deployment fails loudly instead of silently choosing a policy.
On-chain ledger records are out of scope (§1) and are never passed through
this policy.

## 5. Prediction request logging (acceptance criterion 4)

`_log_prediction()` applies the same rules:

- `input_hash` is the SHA-256 of the **scrubbed** input text, so hashes cannot
  be used to recover personal data by dictionary matching against raw text.
- `raw_input` is stored only when `LOG_PREDICTION_RAW_INPUT=true`, and the
  stored value is the scrubbed text.
- The `output` payload is scrubbed with `scrub_record()` before the write.

## 6. Known limitations

- Pattern-based redaction is heuristic: unstructured personal data (a name in
  a sentence) is not detected. The `author` identifier field is masked in full
  for that reason.
- Free text may still carry personal data in forms the patterns do not model
  (e.g. passport numbers). The inventory-driven design means new patterns can
  be added in one place (`TEXT_PATTERNS`).
- Legacy rows written before this stage existed are not retroactively scrubbed;
  a backfill over historical data would be a separate task.

## 7. Verification

```bash
cd apps/data-processing
python -m pytest tests/test_privacy_scrubbing.py -q
```

Tests cover the policy resolution (including invalid values), each redaction
pattern, idempotency, the inventory/structural field behaviour, and all three
enforcement stages (fetchers, `PostgresService` with a SQLite backend, and
`_log_prediction`).
