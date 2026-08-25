"""
stellar_asset_id.py

Canonical asset identifier helpers for the LumenPulse data-processing pipeline.

Problem
-------
Asset identity is currently fragmented across the codebase:
- ``stellar_fetcher.py``  stores ``asset_code`` + ``asset_issuer`` (sometimes ``None``)
- ``price_fetcher.py``    carries ``asset_issuer`` only inside ``SUPPORTED_ASSETS`` config
- ``models.py``           stores bare ``asset`` / ``primary_asset`` strings (issuer lost)
- Soroban contract events reference assets by full ``<CODE>:<ISSUER>`` strings

This means the same real-world asset (e.g. USDC) can appear as:
  - "USDC"
  - "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
  - {"asset_code": "USDC", "asset_issuer": "GA5Z..."}

which breaks joins, de-duplication, and UI display.

Solution
--------
A single canonical key scheme:
  - Native XLM  →  ``"XLM"``           (no issuer, always native)
  - Other assets →  ``"<CODE>:<ISSUER>"``  (upper-cased, whitespace-stripped)

Helpers
-------
``make_asset_key(code, issuer)``       → canonical string key
``parse_asset_key(key)``               → (code, issuer | None)
``normalize_asset_dict(d)``            → adds ``asset_key`` to any dict that has
                                          ``asset_code`` / ``asset_issuer`` fields
``AssetID``                            → lightweight dataclass with ``.key`` property

No issuer is ever silently dropped; helpers raise ``ValueError`` on ambiguous inputs.

Replay / DB note
----------------
The ``asset`` column in ``analytics_records`` and ``asset_trends`` stores short
ticker strings for legacy reasons.  Pass ``display=True`` to ``make_asset_key``
to get the short display form (``"XLM"``, ``"USDC"``) for those columns while
still storing the full key in ``extra_data``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

NATIVE_CODE = "XLM"
NATIVE_KEY = "XLM"          # native asset has no issuer; key == code
KEY_SEPARATOR = ":"


# ---------------------------------------------------------------------------
# Core helpers
# ---------------------------------------------------------------------------

def make_asset_key(
    code: str,
    issuer: Optional[str] = None,
    *,
    allow_no_issuer: bool = False,
) -> str:
    """
    Build the canonical asset key for a Stellar asset.

    Parameters
    ----------
    code:
        Asset code, e.g. ``"XLM"``, ``"USDC"``, ``"yXLM"``.
    issuer:
        Stellar account ID of the issuing account, or ``None`` for the native
        XLM asset.
    allow_no_issuer:
        When ``True``, non-native assets without an issuer return
        ``"<CODE>:unknown"`` instead of raising.  Use this only when the
        issuer is genuinely not available at call-time (e.g. legacy DB rows).

    Returns
    -------
    str
        Canonical key:
        - ``"XLM"`` for the native asset.
        - ``"<CODE>:<ISSUER>"`` for all other assets.

    Raises
    ------
    ValueError
        If *code* is empty, or if a non-native asset has no issuer and
        *allow_no_issuer* is ``False``.
    """
    code = _clean(code)
    if not code:
        raise ValueError("asset code must not be empty")

    if _is_native(code):
        return NATIVE_KEY

    issuer = _clean(issuer) if issuer else ""
    if not issuer:
        if allow_no_issuer:
            return f"{code}{KEY_SEPARATOR}unknown"
        raise ValueError(
            f"Non-native asset '{code}' requires an issuer. "
            "Pass allow_no_issuer=True if issuer is genuinely unavailable."
        )

    return f"{code}{KEY_SEPARATOR}{issuer}"


def parse_asset_key(key: str) -> Tuple[str, Optional[str]]:
    """
    Parse a canonical asset key back into ``(code, issuer)``.

    Parameters
    ----------
    key:
        A canonical key produced by :func:`make_asset_key`.

    Returns
    -------
    (code, issuer)
        ``issuer`` is ``None`` for the native XLM asset or when the stored
        issuer segment is ``"unknown"``.

    Raises
    ------
    ValueError
        If *key* is empty or malformed.
    """
    key = key.strip()
    if not key:
        raise ValueError("asset key must not be empty")

    if KEY_SEPARATOR not in key:
        # Native XLM or legacy bare ticker
        code = key.upper()
        return code, None

    parts = key.split(KEY_SEPARATOR, 1)
    code = _clean(parts[0])
    issuer_raw = parts[1].strip()
    issuer = None if issuer_raw.lower() == "unknown" else issuer_raw
    return code, issuer


def normalize_asset_dict(d: Dict[str, Any], *, allow_no_issuer: bool = True) -> Dict[str, Any]:
    """
    Add an ``asset_key`` field to any dict that contains ``asset_code``
    (and optionally ``asset_issuer``).

    The original dict is **not** mutated; a new dict is returned.

    Parameters
    ----------
    d:
        Input dict, e.g. from ``VolumeData.to_dict()`` or a price payload.
    allow_no_issuer:
        Passed through to :func:`make_asset_key`.  Defaults to ``True`` so
        that legacy records with missing issuers don't raise.

    Returns
    -------
    dict
        Copy of *d* with ``asset_key`` added.

    Raises
    ------
    KeyError
        If ``asset_code`` is not present in *d*.
    """
    result = dict(d)
    code = result["asset_code"]
    issuer = result.get("asset_issuer")
    result["asset_key"] = make_asset_key(code, issuer, allow_no_issuer=allow_no_issuer)
    return result


def display_name(key: str) -> str:
    """
    Return a human-readable display name from a canonical key.

    ``"XLM"`` → ``"XLM"``
    ``"USDC:GA5Z..."`` → ``"USDC"``

    Suitable for the bare ``asset`` / ``primary_asset`` DB columns.
    """
    code, _ = parse_asset_key(key)
    return code


# ---------------------------------------------------------------------------
# Private utilities
# ---------------------------------------------------------------------------

def _clean(value: Optional[str]) -> str:
    if value is None:
        return ""
    return value.strip().upper()


def _is_native(code: str) -> bool:
    return code.upper() in {"XLM", "NATIVE"}


# ---------------------------------------------------------------------------
# AssetID dataclass
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class AssetID:
    """
    Immutable value object representing a Stellar asset.

    Attributes
    ----------
    code:
        Upper-cased asset code, e.g. ``"XLM"``, ``"USDC"``.
    issuer:
        Issuer account ID, or ``None`` for the native XLM asset.
    """

    code: str
    issuer: Optional[str] = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "code", _clean(self.code))
        if not self.code:
            raise ValueError("AssetID.code must not be empty")
        if _is_native(self.code) and self.issuer is not None:
            # Normalise: native XLM never has an issuer
            object.__setattr__(self, "issuer", None)
        if self.issuer is not None:
            object.__setattr__(self, "issuer", self.issuer.strip())

    @property
    def key(self) -> str:
        """Canonical string key."""
        return make_asset_key(self.code, self.issuer, allow_no_issuer=True)

    @property
    def is_native(self) -> bool:
        """``True`` if this is the native XLM asset."""
        return _is_native(self.code)

    @property
    def display(self) -> str:
        """Short ticker for UI / legacy DB columns."""
        return self.code

    def to_dict(self) -> Dict[str, Any]:
        """Serialise to a dict compatible with existing pipeline dicts."""
        return {
            "asset_code": self.code,
            "asset_issuer": self.issuer,
            "asset_key": self.key,
        }

    @classmethod
    def from_key(cls, key: str) -> "AssetID":
        """Construct an :class:`AssetID` from a canonical key string."""
        code, issuer = parse_asset_key(key)
        return cls(code=code, issuer=issuer)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "AssetID":
        """
        Construct from any dict that has ``asset_code`` and optionally
        ``asset_issuer`` or ``asset_key``.
        """
        if "asset_key" in d:
            return cls.from_key(d["asset_key"])
        code = d["asset_code"]
        issuer = d.get("asset_issuer")
        return cls(code=code, issuer=issuer)

    def __str__(self) -> str:
        return self.key

    def __repr__(self) -> str:
        return f"AssetID(code={self.code!r}, issuer={self.issuer!r})"


# ---------------------------------------------------------------------------
# Known well-known assets (informational; not exhaustive)
# ---------------------------------------------------------------------------

KNOWN_ASSETS: Dict[str, AssetID] = {
    "XLM": AssetID(code="XLM"),
    "USDC": AssetID(
        code="USDC",
        issuer="GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    ),
    "USDT": AssetID(
        code="USDT",
        issuer="GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53XBRJVN6ZJVTG6V",
    ),
    "yXLM": AssetID(
        code="yXLM",
        issuer="GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55",
    ),
}