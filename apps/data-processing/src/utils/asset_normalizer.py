"""
Asset Issuer Normalization Utility

Provides canonical normalization for Stellar blockchain assets.
Handles native assets (XLM/Lumens) and issued assets (code + issuer pairs),
converting various input formats into a consistent canonical form.

Canonical forms:
    - Native asset:  {"asset_type": "native", "asset_code": "XLM", "asset_issuer": null, "canonical": "native"}
    - Issued asset:  {"asset_type": "credit_alphanum4" | "credit_alphanum12",
                      "asset_code": "CODE", "asset_issuer": "G...",
                      "canonical": "CODE:G..."}

Supported input formats:
    - String: "native", "XLM", "USDC:GABCD...", "USDC-GABCD..."
    - Dict:   {"asset_code": "USDC", "asset_issuer": "GABCD..."}
    - Tuple:  ("USDC", "GABCD...")
"""

import re
import logging
from dataclasses import dataclass, asdict
from typing import Any, Dict, Optional, Union

logger = logging.getLogger(__name__)

# Recognized aliases for the native Stellar asset (XLM / Lumens)
NATIVE_ASSET_ALIASES = frozenset({
    "xlm", "native", "lumens", "lumen", "stellar",
})

# Stellar public keys start with 'G' and are 56 characters (base32-encoded Ed25519)
STELLAR_PUBLIC_KEY_PATTERN = re.compile(r"^G[A-Z2-7]{55}$")

# Maximum asset code lengths per Stellar protocol
MAX_ALPHANUM4_LENGTH = 4
MAX_ALPHANUM12_LENGTH = 12


@dataclass(frozen=True)
class NormalizedAsset:
    """Immutable representation of a canonically normalized Stellar asset."""

    asset_type: str          # "native", "credit_alphanum4", or "credit_alphanum12"
    asset_code: str          # "XLM" for native, uppercase code for issued
    asset_issuer: Optional[str]  # None for native, G-address for issued
    canonical: str           # "native" or "CODE:ISSUER"

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to a plain dictionary."""
        return asdict(self)


class AssetNormalizationError(Exception):
    """Raised when an asset input cannot be normalized."""
    pass


def _is_native_alias(value: str) -> bool:
    """Check whether a string is a recognized native-asset alias."""
    return value.strip().lower() in NATIVE_ASSET_ALIASES


def _validate_issuer(issuer: str) -> str:
    """
    Validate and return a cleaned Stellar issuer public key.

    Args:
        issuer: Raw issuer string.

    Returns:
        Uppercased, stripped issuer key.

    Raises:
        AssetNormalizationError: If the issuer fails validation.
    """
    cleaned = issuer.strip().upper()
    if not STELLAR_PUBLIC_KEY_PATTERN.match(cleaned):
        raise AssetNormalizationError(
            f"Invalid Stellar issuer public key: '{issuer}' "
            f"(must be 56 characters starting with 'G', base32 alphabet)"
        )
    return cleaned


def _validate_asset_code(code: str) -> str:
    """
    Validate and return a cleaned Stellar asset code.

    Args:
        code: Raw asset code string.

    Returns:
        Uppercased, stripped asset code.

    Raises:
        AssetNormalizationError: If the code fails validation.
    """
    cleaned = code.strip().upper()
    if not cleaned:
        raise AssetNormalizationError("Asset code cannot be empty")
    if len(cleaned) > MAX_ALPHANUM12_LENGTH:
        raise AssetNormalizationError(
            f"Asset code '{cleaned}' exceeds maximum length of "
            f"{MAX_ALPHANUM12_LENGTH} characters"
        )
    if not re.match(r"^[A-Za-z0-9]+$", cleaned):
        raise AssetNormalizationError(
            f"Asset code '{cleaned}' contains invalid characters "
            f"(only alphanumeric allowed)"
        )
    return cleaned


def _determine_asset_type(code: str) -> str:
    """Determine Stellar asset type from the code length."""
    if len(code) <= MAX_ALPHANUM4_LENGTH:
        return "credit_alphanum4"
    return "credit_alphanum12"


def _build_native_asset() -> NormalizedAsset:
    """Build the canonical native asset representation."""
    return NormalizedAsset(
        asset_type="native",
        asset_code="XLM",
        asset_issuer=None,
        canonical="native",
    )


def _build_issued_asset(code: str, issuer: str) -> NormalizedAsset:
    """Build a canonical issued-asset representation."""
    validated_code = _validate_asset_code(code)
    validated_issuer = _validate_issuer(issuer)
    asset_type = _determine_asset_type(validated_code)
    canonical = f"{validated_code}:{validated_issuer}"
    return NormalizedAsset(
        asset_type=asset_type,
        asset_code=validated_code,
        asset_issuer=validated_issuer,
        canonical=canonical,
    )


def _normalize_from_string(raw: str) -> NormalizedAsset:
    """
    Normalize an asset from a raw string.

    Accepted formats:
        - "native", "XLM", "lumens" → native asset
        - "USDC:G..." or "USDC-G..." → issued asset
    """
    stripped = raw.strip()
    if not stripped:
        raise AssetNormalizationError("Cannot normalize empty string input")

    # Check for native aliases first
    if _is_native_alias(stripped):
        return _build_native_asset()

    # Try splitting on ':' or '-' for issued assets
    for delimiter in (":", "-"):
        if delimiter in stripped:
            parts = stripped.split(delimiter, maxsplit=1)
            code = parts[0].strip()
            issuer = parts[1].strip()
            if not issuer:
                raise AssetNormalizationError(
                    f"Missing issuer after delimiter '{delimiter}' in '{raw}'"
                )
            # If the code part is a native alias, that's an error
            if _is_native_alias(code):
                raise AssetNormalizationError(
                    f"Native asset '{code}' cannot have an issuer"
                )
            return _build_issued_asset(code, issuer)

    # No delimiter — could be just an asset code without issuer
    # Only native aliases are valid without an issuer
    raise AssetNormalizationError(
        f"Non-native asset code '{stripped}' requires an issuer (use 'CODE:ISSUER' format)"
    )


def _normalize_from_dict(raw: Dict[str, Any]) -> NormalizedAsset:
    """
    Normalize an asset from a dictionary.

    Expected keys:
        - asset_code (or code): str
        - asset_issuer (or issuer): Optional[str]
        - asset_type: Optional[str] — if "native", treated as native
    """
    # Extract asset type hint
    asset_type = str(raw.get("asset_type", "")).strip().lower()
    if asset_type == "native":
        return _build_native_asset()

    # Extract code
    code = raw.get("asset_code") or raw.get("code") or ""
    code = str(code).strip()

    if not code:
        raise AssetNormalizationError(
            f"Dictionary input missing 'asset_code' or 'code' key: {raw}"
        )

    # Check for native alias in code field
    if _is_native_alias(code):
        issuer = raw.get("asset_issuer") or raw.get("issuer")
        if issuer and str(issuer).strip():
            raise AssetNormalizationError(
                f"Native asset '{code}' cannot have an issuer"
            )
        return _build_native_asset()

    # Extract issuer
    issuer = raw.get("asset_issuer") or raw.get("issuer") or ""
    issuer = str(issuer).strip()

    if not issuer:
        raise AssetNormalizationError(
            f"Non-native asset code '{code}' requires an issuer"
        )

    return _build_issued_asset(code, issuer)


def _normalize_from_tuple(raw: tuple) -> NormalizedAsset:
    """
    Normalize an asset from a tuple of (code,) or (code, issuer).
    """
    if len(raw) == 1:
        code = str(raw[0]).strip()
        if _is_native_alias(code):
            return _build_native_asset()
        raise AssetNormalizationError(
            f"Non-native asset code '{code}' requires an issuer (provide a 2-tuple)"
        )
    elif len(raw) == 2:
        code = str(raw[0]).strip()
        issuer = str(raw[1]).strip()
        if _is_native_alias(code):
            if issuer:
                raise AssetNormalizationError(
                    f"Native asset '{code}' cannot have an issuer"
                )
            return _build_native_asset()
        if not issuer:
            raise AssetNormalizationError(
                f"Non-native asset code '{code}' requires an issuer"
            )
        return _build_issued_asset(code, issuer)
    else:
        raise AssetNormalizationError(
            f"Tuple input must have 1 or 2 elements, got {len(raw)}"
        )


def normalize_asset(raw_input: Optional[Union[str, Dict[str, Any], tuple]]) -> NormalizedAsset:
    """
    Normalize any supported raw asset input into a canonical NormalizedAsset.

    Args:
        raw_input: Asset data in one of the supported formats:
            - str:   "native", "XLM", "USDC:GABCD..."
            - dict:  {"asset_code": "USDC", "asset_issuer": "GABCD..."}
            - tuple: ("USDC", "GABCD...")

    Returns:
        NormalizedAsset with canonical fields.

    Raises:
        AssetNormalizationError: If the input cannot be normalized.
    """
    if raw_input is None:
        raise AssetNormalizationError("Cannot normalize None input")

    try:
        if isinstance(raw_input, str):
            return _normalize_from_string(raw_input)
        elif isinstance(raw_input, dict):
            return _normalize_from_dict(raw_input)
        elif isinstance(raw_input, (tuple, list)):
            return _normalize_from_tuple(tuple(raw_input))
        else:
            raise AssetNormalizationError(
                f"Unsupported input type: {type(raw_input).__name__}. "
                f"Expected str, dict, or tuple."
            )
    except AssetNormalizationError:
        raise
    except Exception as e:
        raise AssetNormalizationError(
            f"Unexpected error normalizing asset input '{raw_input}': {e}"
        ) from e
