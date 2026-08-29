# Entity Alias Registry & Synonym Management

Projects, assets and ecosystem terms arrive in ingested text under many
spellings. Stellar's native asset shows up as `XLM`, `$XLM`, `lumens`,
`Stellar Lumens` and `Stellar`; the foundation behind it as `SDF` or
`Stellar Development Foundation`. Before this registry, each module that cared
carried its own hand-written mapping, so teaching the pipeline a new spelling
meant editing pipeline code in several places — and the mappings drifted apart.

The registry is one YAML file plus one loader. **Adding an alias is a data
change, not a code change.**

- **Registry:** [`config/entity_aliases.yaml`](config/entity_aliases.yaml)
- **Loader / normalization API:** [`src/analytics/entity_alias_registry.py`](src/analytics/entity_alias_registry.py)
- **Validator:** [`scripts/validate_entity_aliases.py`](scripts/validate_entity_aliases.py)
- **Tests:** [`tests/test_entity_alias_registry.py`](tests/test_entity_alias_registry.py)

---

## Contributor workflow

### 1. Edit the registry

```yaml
  - canonical_id: asset:XLM        # stable join key, unique across the file
    entity_type: asset             # asset | project | organization | ecosystem | contributor
    display_name: Stellar          # canonical human-readable label
    asset_code: XLM                # ticker (see "asset_code" below)
    aliases:                       # every other spelling
      - Stellar
      - Stellar Lumens
      - lumens
      - lumen
    tags: [stellar, layer1]        # optional, free-form grouping labels
    notes: >                       # optional, why these aliases are here
      "lumen"/"lumens" are common in Stellar community writing.
```

### 2. Validate

```bash
python scripts/validate_entity_aliases.py            # summary + warnings
python scripts/validate_entity_aliases.py --strict   # what CI runs
python scripts/validate_entity_aliases.py --summary  # every entity and alias
```

Sanity-check the behaviour you intended, without writing a script:

```bash
$ python scripts/validate_entity_aliases.py --resolve '$xlm'
'$xlm' -> asset:XLM (Stellar), tagged as 'XLM'

$ python scripts/validate_entity_aliases.py --text 'Lumens rallied after the SDF grant to Soroban builders'
  'Lumens' -> asset:XLM (tagged as 'Stellar')
  'SDF' -> organization:sdf (tagged as 'Stellar Development Foundation')
  'Soroban' -> project:soroban (tagged as 'Soroban')
```

### 3. Open a PR

`--strict` runs in the Data Processing CI job, so a malformed registry fails
the build rather than silently degrading extraction.

No pipeline code changes are needed: `NERService`, `KeywordExtractor`,
`OnchainEntityLinker` and `PostgresService` all read the registry at
construction time.

---

## Field reference

| Field | Required | Meaning |
| --- | --- | --- |
| `canonical_id` | yes | Stable join key, unique across the file. Shape `<type>:<slug>`, e.g. `asset:XLM`, `project:soroban`. Downstream datasets group on this — treat it as an API. |
| `entity_type` | yes | `asset`, `project`, `organization`, `ecosystem` or `contributor`. |
| `display_name` | yes | Canonical human-readable label. |
| `asset_code` | no | Ticker / asset code. On `entity_type: asset` it is also a *spelling* of the entity. On any other type it records the **related** asset (Soroban settles in XLM) and is deliberately **not** an alias — otherwise "XLM" would read as "Soroban". |
| `aliases` | no | Every other spelling. Matching is case-insensitive, ignores a leading `$`, and tolerates punctuation and spacing differences — so list each spelling once, in its most natural form. |
| `tags` | no | Free-form grouping labels for analytics filters (`registry.entities_by_tag("stellar")`). |
| `notes` | no | Why an alias is here. Helps the next reviewer. |

### Canonical identity vs. surface form

Two different questions, two different answers:

- **Which entity is this?** → `canonical_id`. `XLM`, `$XLM`, `lumens` and
  `Stellar` all answer `asset:XLM`. This is what datasets join on.
- **What do we call it when tagging text?** → the *surface form*. An article
  saying `$XLM` is tagged `XLM`; one saying `lumens` is tagged `Stellar`.
  Assets keep their ticker when the ticker itself was matched, so tags stay
  readable and match what a reader saw.

### Alias uniqueness

An alias claimed by two canonical entities is a **hard error**, not a
last-one-wins. The registry refuses to build and the validator exits non-zero,
naming both entities. This is the guard rail that keeps the registry
trustworthy as it grows.

If two entities genuinely share a spelling, the ambiguity has to be resolved in
the data: make the alias more specific, or drop it from the entity where the
match would be wrong more often.

---

## Normalization API

```python
from src.analytics.entity_alias_registry import get_registry

registry = get_registry()

registry.resolve("$xlm").canonical_id      # 'asset:XLM'
registry.canonical_id_for("stellar lumens")  # 'asset:XLM'
registry.surface_form("lumens")            # 'Stellar'
registry.surface_form("$XLM")              # 'XLM'
registry.surface_form("Acme Holdings")     # 'Acme Holdings' (unregistered: passthrough)

registry.aliases_for("asset:XLM")          # every spelling
registry.entities_by_type("asset")         # all asset entities
registry.entities_by_tag("stellar")        # all Stellar-ecosystem entities

# Collapse a list of extracted terms onto one value per canonical entity,
# preserving input order and keeping unregistered terms.
registry.normalize_terms(["$XLM", "lumens", "Acme"])   # ['XLM', 'Acme']

# Find registered aliases in free text (longest alias wins; overlapping
# matches are one mention, so "Stellar" inside "Stellar Development
# Foundation" does not also tag asset:XLM).
for mention in registry.find_in_text("Lumens rallied after the SDF grant"):
    mention.canonical_id, mention.matched_text, mention.surface_form
```

`get_registry()` caches a process-wide instance. Call `reload_registry()` to
pick up an edited file in a long-running process, or pass an explicit
`registry=` to any consumer (`NERService(registry=...)`,
`OnchainEntityLinker(registry=...)`, `KeywordExtractor(registry=...)`) in
tests.

### Loading and fallback

Resolution order:

1. an explicit path passed to `EntityAliasRegistry.load(path)` — failures raise
2. `$ENTITY_ALIAS_REGISTRY_PATH`
3. `config/entity_aliases.yaml`
4. the built-in seed derived from `src/analytics/keywords.py`

A missing, unreadable or invalid file at steps 2–3 logs and falls back to the
seed, so a bad deploy degrades to the pre-registry alias set instead of
dropping entity extraction entirely. An explicitly requested path raises
instead, so tooling and tests fail loudly.

---

## Where the registry is used

| Consumer | What it uses the registry for |
| --- | --- |
| [`src/analytics/ner_service.py`](src/analytics/ner_service.py) | Canonicalizes extracted entities, seeds spaCy `entity_ruler` phrase patterns, and extends the known-ticker set. |
| [`src/analytics/keywords.py`](src/analytics/keywords.py) | `KeywordExtractor.extract` adds the canonical name and asset code for every registry alias found. |
| [`src/analytics/onchain_entity_linker.py`](src/analytics/onchain_entity_linker.py) | Default asset link candidates. The registry's `canonical_id` **is** the linker's `stable_id`, so canonical aliases and link keys cannot drift apart. |
| [`src/db/postgres_service.py`](src/db/postgres_service.py) | Canonicalizes `Article.detected_entities` on write and resolves both sides of the entity filter in `get_recent_articles`. |

The legacy dictionaries in `src/analytics/keywords.py` (`CRYPTO_PROJECT_MAP`,
`TICKER_TO_PROJECT`, `KNOWN_TICKERS`) are still consulted as a base layer and
still back the fallback seed. New and edited aliases belong in the YAML.

---

## Downstream dataset: news article entities

`Article.detected_entities` is the column the sentiment, attribution and API
consumers filter on. It benefits from the registry on both sides:

**On write** — whatever spelling a fetcher supplies is canonicalized, so one
entity is stored as one value:

```python
{"detected_entities": ["$XLM", "lumens", "Stellar Lumens"]}   # from a feed
# persisted as
["XLM"]
```

**On read** — the entity filter resolves both sides through the registry, so
any registered spelling retrieves the same articles:

```python
service.get_recent_articles(entity="lumens")   # finds articles tagged "XLM"
service.get_recent_articles(entity="$XLM")     # same articles
service.get_recent_articles(entity="Stellar")  # same articles
```

Previously this filter compared lowercased strings, so querying `lumens` or
`$XLM` returned nothing for an article tagged `XLM`. Unregistered terms keep
the old exact, case-insensitive comparison.

On-chain entity links get the same benefit: `Lumens volume climbed while USD
Coin supply grew` now produces `asset:XLM` and `asset:USDC` links, where
before neither spelling matched.

---

## Adding a new entity: worked example

A new Soroban project, "Lumen Launch", written variously as `LumenLaunch`,
`lumen-launch` and `LL`:

```yaml
  - canonical_id: project:lumen-launch
    entity_type: project
    display_name: Lumen Launch
    asset_code: XLM
    aliases:
      - LumenLaunch
      - lumen-launch
    tags: [stellar, testnet]
    notes: >
      "LL" is deliberately omitted -- two letters is too short to match in
      free text and collides with unrelated prose.
```

```bash
$ python scripts/validate_entity_aliases.py --strict
$ python scripts/validate_entity_aliases.py --resolve 'lumen launch'
'lumen launch' -> project:lumen-launch (Lumen Launch), tagged as 'Lumen Launch'
```

Note that `lumen-launch` and `LumenLaunch` would resolve anyway via
punctuation-insensitive matching; listing them explicitly documents the intent
and makes the alias searchable in the file.

Aliases shorter than three characters are reported as warnings: they still
resolve through `resolve()` / `canonical_id_for()`, but they are not searched
for in free text, because two-letter tokens produce far more false positives
than real matches.
