"""
Privacy controls for ingested data (#1452).

See ``doc/personal-data-policy.md`` for the policy this package enforces.
"""

from .scrubbing import (
    DEFAULT_WALLET_ADDRESS_POLICY,
    INVENTORY_FIELDS,
    PERSONAL_DATA_INVENTORY,
    STRUCTURAL_FIELDS,
    WALLET_ADDRESS_POLICIES,
    WALLET_ADDRESS_POLICY_ENV,
    PersonalDataField,
    get_wallet_address_policy,
    scrub_record,
    scrub_text,
)

__all__ = [
    "DEFAULT_WALLET_ADDRESS_POLICY",
    "INVENTORY_FIELDS",
    "PERSONAL_DATA_INVENTORY",
    "STRUCTURAL_FIELDS",
    "WALLET_ADDRESS_POLICIES",
    "WALLET_ADDRESS_POLICY_ENV",
    "PersonalDataField",
    "get_wallet_address_policy",
    "scrub_record",
    "scrub_text",
]
