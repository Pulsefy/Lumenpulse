"""
Personal-data scrubbing stage for ingested content (#1452).

News, social and prediction text pulled by ``src/ingestion/`` can carry
personal data (contact details, social handles, wallet addresses) that
would otherwise propagate into the feature store, training data and
prediction logs.  This module is the single implementation of the rules
documented in ``doc/personal-data-policy.md``:

* :data:`PERSONAL_DATA_INVENTORY` — which ingested fields can contain
  personal data and how each one is treated.
* :func:`scrub_text` — pattern redaction for free text.
* :func:`scrub_record` — field-aware scrub of one ingested record.

The stage runs at the ingestion boundary (the fetchers) and is enforced
again at the persistence boundary (``PostgresService.save_*``) and in
prediction request logging, so no writer can bypass it.  Scrubbing is
idempotent: placeholders never re-match the patterns.

Wallet addresses are handled by an explicit, documented policy
(:func:`get_wallet_address_policy`) rather than by an implicit default.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any, Dict, Mapping, Optional, Tuple

# ---------------------------------------------------------------------------
# Wallet-address policy (#1452)
# ---------------------------------------------------------------------------

WALLET_ADDRESS_POLICY_ENV = "PRIVACY_WALLET_ADDRESS_POLICY"
WALLET_ADDRESS_POLICIES: Tuple[str, ...] = ("mask", "retain")
DEFAULT_WALLET_ADDRESS_POLICY = "mask"

# ---------------------------------------------------------------------------
# Placeholders
# ---------------------------------------------------------------------------

WALLET_ADDRESS_PLACEHOLDER = "[WALLET_ADDRESS]"
EMAIL_PLACEHOLDER = "[EMAIL]"
SSN_PLACEHOLDER = "[SSN]"
CREDIT_CARD_PLACEHOLDER = "[CREDIT_CARD]"
PHONE_PLACEHOLDER = "[PHONE]"
IP_ADDRESS_PLACEHOLDER = "[IP_ADDRESS]"
HANDLE_PLACEHOLDER = "[HANDLE]"

# ---------------------------------------------------------------------------
# Patterns
# ---------------------------------------------------------------------------

# Stellar (G...) and EVM (0x...) addresses as they appear inside free text.
WALLET_ADDRESS_PATTERN = re.compile(r"\bG[A-Z2-7]{55}\b|\b0x[a-fA-F0-9]{40}\b")

# Order matters: e-mail before handles (so "a@b.com" is never re-cut), social
# security and card numbers before phone numbers (narrower shapes first).
TEXT_PATTERNS: Tuple[Tuple[re.Pattern, str], ...] = (
    (
        re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
        EMAIL_PLACEHOLDER,
    ),
    (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), SSN_PLACEHOLDER),
    (re.compile(r"\b\d{4}(?:[ -]\d{4}){3}\b"), CREDIT_CARD_PLACEHOLDER),
    (
        re.compile(
            r"(?:"
            r"\+\d[\d\s().-]{6,}\d\b"  # +44 20 7123 4567
            r"|\(\d{3}\)\s*\d{3}[-.\s]\d{4}\b"  # (555) 123-4567
            r"|(?<!\d)\d{3}\s\d{3}\s\d{4}\b"  # 555 123 4567
            r"|(?<!\d)\d{3}[-.]\d{3}[-.]\d{4}\b"  # 555-123-4567
            r")"
        ),
        PHONE_PLACEHOLDER,
    ),
    (re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"), IP_ADDRESS_PLACEHOLDER),
    (re.compile(r"(?<![\w@])@[A-Za-z0-9_]{2,}\b"), HANDLE_PLACEHOLDER),
)

# ---------------------------------------------------------------------------
# Field inventory
# ---------------------------------------------------------------------------

TREATMENT_TEXT = "text"
TREATMENT_IDENTIFIER = "identifier"

TREATMENTS: Tuple[str, ...] = (TREATMENT_TEXT, TREATMENT_IDENTIFIER)


@dataclass(frozen=True)
class PersonalDataField:
    """One row of the ingested personal-data field inventory."""

    field: str
    records: str
    personal_data: str
    treatment: str
    placeholder: str = ""


PERSONAL_DATA_INVENTORY: Tuple[PersonalDataField, ...] = (
    PersonalDataField(
        "title",
        "news article",
        "Contact details or wallet addresses quoted in the headline",
        TREATMENT_TEXT,
    ),
    PersonalDataField(
        "content",
        "news article, social post",
        "Free text: e-mails, phone numbers, IPs, social handles, wallet addresses",
        TREATMENT_TEXT,
    ),
    PersonalDataField(
        "summary",
        "news article",
        "Same free-text exposure as content",
        TREATMENT_TEXT,
    ),
    PersonalDataField(
        "author",
        "social post",
        "Platform username / handle of the poster",
        TREATMENT_IDENTIFIER,
        placeholder="[AUTHOR]",
    ),
    PersonalDataField(
        "url",
        "news article, social post",
        "E-mails, IP hosts or account identifiers embedded in links or query strings",
        TREATMENT_TEXT,
    ),
    PersonalDataField(
        "hashtags",
        "social post",
        "Handle-style labels copied from the post",
        TREATMENT_TEXT,
    ),
    PersonalDataField(
        "tags",
        "news article",
        "Free-text tags copied from the source feed",
        TREATMENT_TEXT,
    ),
    PersonalDataField(
        "keywords",
        "derived article tags",
        "Keywords derived from source text (scrubbed first)",
        TREATMENT_TEXT,
    ),
    PersonalDataField(
        "detected_entities",
        "derived article tags",
        "Entities extracted from source text (scrubbed first)",
        TREATMENT_TEXT,
    ),
    PersonalDataField(
        "input_text",
        "prediction log",
        "Caller-supplied text analysed by the model",
        TREATMENT_TEXT,
    ),
    PersonalDataField(
        "raw_input",
        "prediction log",
        "Stored copy of the request text (only when LOG_PREDICTION_RAW_INPUT=true)",
        TREATMENT_TEXT,
    ),
)

INVENTORY_FIELDS: Tuple[str, ...] = tuple(row.field for row in PERSONAL_DATA_INVENTORY)

# Structural fields: identifiers, labels and timestamps that cannot carry
# personal data.  They are left untouched so record identity and ordering
# keep working after the scrub.
STRUCTURAL_FIELDS = frozenset(
    {
        "id",
        "article_id",
        "post_id",
        "request_id",
        "model_type",
        "model_version",
        "platform",
        "source",
        "subreddit",
        "language",
        "primary_asset",
        "asset_codes",
        "categories",
        "published_at",
        "posted_at",
        "fetched_at",
        "analyzed_at",
        "created_at",
        "updated_at",
        "timestamp",
    }
)

_INVENTORY_BY_FIELD = {row.field: row for row in PERSONAL_DATA_INVENTORY}


def get_wallet_address_policy(raw: Optional[str] = None) -> str:
    """Resolve the wallet-address policy.

    Reads ``PRIVACY_WALLET_ADDRESS_POLICY`` (``mask`` or ``retain``) unless an
    explicit value is supplied.  Unknown values are rejected instead of
    silently falling back, so a misconfigured deployment fails loudly.

    :param raw: explicit policy value, or ``None`` to read the environment.
    :raises ValueError: if the policy is not one of :data:`WALLET_ADDRESS_POLICIES`.
    """
    if raw is None:
        raw = os.getenv(WALLET_ADDRESS_POLICY_ENV, DEFAULT_WALLET_ADDRESS_POLICY)
    policy = raw.strip().lower()
    if not policy:
        policy = DEFAULT_WALLET_ADDRESS_POLICY
    if policy not in WALLET_ADDRESS_POLICIES:
        raise ValueError(
            f"Invalid {WALLET_ADDRESS_POLICY_ENV}={raw!r}; expected one of "
            f"{', '.join(WALLET_ADDRESS_POLICIES)}"
        )
    return policy


def _apply_scrub(text: str, wallet_policy: str) -> str:
    scrubbed = text
    if wallet_policy == "mask":
        scrubbed = WALLET_ADDRESS_PATTERN.sub(WALLET_ADDRESS_PLACEHOLDER, scrubbed)
    for pattern, placeholder in TEXT_PATTERNS:
        scrubbed = pattern.sub(placeholder, scrubbed)
    return scrubbed


def scrub_text(text: str, *, wallet_policy: Optional[str] = None) -> str:
    """Redact personal-data patterns from one free-text value.

    :param text: the text to scrub; empty input is returned unchanged.
    :param wallet_policy: optional policy override, see
        :func:`get_wallet_address_policy`.
    :return: the scrubbed text (idempotent).
    """
    if not text:
        return text
    policy = get_wallet_address_policy(wallet_policy)
    return _apply_scrub(text, policy)


def _scrub_value(key: str, value: Any, wallet_policy: str) -> Any:
    if isinstance(value, str):
        if key in STRUCTURAL_FIELDS:
            return value
        field = _INVENTORY_BY_FIELD.get(key)
        if field is not None and field.treatment == TREATMENT_IDENTIFIER:
            return field.placeholder if value else value
        return _apply_scrub(value, wallet_policy)
    if isinstance(value, Mapping):
        return {k: _scrub_value(k, v, wallet_policy) for k, v in value.items()}
    if isinstance(value, tuple):
        return tuple(_scrub_value(key, item, wallet_policy) for item in value)
    if isinstance(value, list):
        return [_scrub_value(key, item, wallet_policy) for item in value]
    return value


def scrub_record(
    record: Mapping[str, Any], *, wallet_policy: Optional[str] = None
) -> Dict[str, Any]:
    """Scrub one ingested record before persistence or feature computation.

    Fields listed in :data:`PERSONAL_DATA_INVENTORY` are treated per their
    treatment, structural fields are left untouched, and any field that is not
    in the inventory is scrubbed as free text so new fields are covered by
    default.

    :param record: the record to scrub.
    :param wallet_policy: optional policy override, see
        :func:`get_wallet_address_policy`.
    :return: a new dict; the input is not modified.
    """
    if not isinstance(record, Mapping):
        raise TypeError(f"scrub_record expects a mapping, got {type(record).__name__}")
    policy = get_wallet_address_policy(wallet_policy)
    return {key: _scrub_value(key, value, policy) for key, value in record.items()}
