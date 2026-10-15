# Ingestion Dataset SLAs

This table is the explicit freshness and completeness contract for ingested
datasets. Runtime code mirrors these defaults in
`src/ingestion/dataset_sla.py`, exports target/current Prometheus metrics per
dataset, and raises deduped `dataset_sla_breach` alerts through
`src/alert_engine/`.

| Dataset | Owner | Freshness target | Completeness target | Current measurement source | Override environment variables |
|---------|-------|------------------|---------------------|----------------------------|--------------------------------|
| `news_articles` | data-processing | 60 min | 95% | Latest article timestamp; article fetch completeness ratio when supplied, otherwise 1 for available data and 0 for no data | `INGESTION_SLA_NEWS_ARTICLES_FRESHNESS_SECONDS`, `INGESTION_SLA_NEWS_ARTICLES_COMPLETENESS_RATIO` |
| `price_ticks` | data-processing | 15 min | 99% | Latest price observation timestamp; price fetch completeness ratio when supplied, otherwise 1 for available data and 0 for no data | `INGESTION_SLA_PRICE_TICKS_FRESHNESS_SECONDS`, `INGESTION_SLA_PRICE_TICKS_COMPLETENESS_RATIO` |
| `social_posts` | data-processing | 2 hours | 90% | Social ingestion status/check results when supplied by pipeline jobs | `INGESTION_SLA_SOCIAL_POSTS_FRESHNESS_SECONDS`, `INGESTION_SLA_SOCIAL_POSTS_COMPLETENESS_RATIO` |
| `stellar_ledger_events` | data-processing | 5 min | 99.9% | Horizon/latest-ledger lag and quality-check pass ratio | `INGESTION_SLA_STELLAR_LEDGER_EVENTS_FRESHNESS_SECONDS`, `INGESTION_SLA_STELLAR_LEDGER_EVENTS_COMPLETENESS_RATIO` |
| `contract_events` | data-processing | 10 min | 99.9% | Contract event lag and replay/materialization checks when supplied by contract ingestion jobs | `INGESTION_SLA_CONTRACT_EVENTS_FRESHNESS_SECONDS`, `INGESTION_SLA_CONTRACT_EVENTS_COMPLETENESS_RATIO` |
| `analytics_records` | data-processing | 2 hours | 95% | Latest `analytics_records.created_at`; finite lag is counted as currently measurable completeness | `INGESTION_SLA_ANALYTICS_RECORDS_FRESHNESS_SECONDS`, `INGESTION_SLA_ANALYTICS_RECORDS_COMPLETENESS_RATIO` |

## Metrics

- `lumenpulse_ingestion_dataset_freshness_seconds{dataset}`
- `lumenpulse_ingestion_dataset_completeness_ratio{dataset}`
- `lumenpulse_ingestion_dataset_freshness_target_seconds{dataset}`
- `lumenpulse_ingestion_dataset_completeness_target_ratio{dataset}`
- `lumenpulse_ingestion_dataset_sla_breach{dataset,sla_type,severity}`

Completeness is exported as `-1` when a job cannot determine the current ratio.
That is treated as a breach so missing measurement does not silently pass.
