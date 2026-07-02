"""
tests/test_stellar_asset_id.py

Unit tests for stellar_asset_id.py (issue #746).

Covers all three acceptance criteria:
1. Canonical asset key scheme documented & validated.
2. Conversion helpers implemented (make_asset_key, parse_asset_key,
   normalize_asset_dict, AssetID).
3. No issuer-loss in UI-facing fields.
"""

from __future__ import annotations

import pytest

from src.ingestion.stellar_asset_id import (
    KNOWN_ASSETS,
    NATIVE_KEY,
    AssetID,
    display_name,
    make_asset_key,
    normalize_asset_dict,
    parse_asset_key,
)

USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
USDT_ISSUER = "GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53XBRJVN6ZJVTG6V"
YXLM_ISSUER = "GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55"


# ---------------------------------------------------------------------------
# 1. make_asset_key
# ---------------------------------------------------------------------------

class TestMakeAssetKey:
    def test_native_xlm_no_issuer(self):
        assert make_asset_key("XLM") == "XLM"

    def test_native_xlm_with_none_issuer(self):
        assert make_asset_key("XLM", None) == "XLM"

    def test_native_keyword(self):
        assert make_asset_key("native") == "XLM"

    def test_non_native_with_issuer(self):
        key = make_asset_key("USDC", USDC_ISSUER)
        assert key == f"USDC:{USDC_ISSUER}"

    def test_code_is_uppercased(self):
        key = make_asset_key("usdc", USDC_ISSUER)
        assert key.startswith("USDC:")

    def test_whitespace_is_stripped(self):
        key = make_asset_key("  USDC  ", f"  {USDC_ISSUER}  ")
        assert key == f"USDC:{USDC_ISSUER}"

    def test_non_native_without_issuer_raises(self):
        with pytest.raises(ValueError, match="requires an issuer"):
            make_asset_key("USDC")

    def test_non_native_without_issuer_allow_flag(self):
        key = make_asset_key("USDC", allow_no_issuer=True)
        assert key == "USDC:unknown"

    def test_empty_code_raises(self):
        with pytest.raises(ValueError):
            make_asset_key("")

    def test_yxlm_asset(self):
        key = make_asset_key("yXLM", YXLM_ISSUER)
        assert key == f"yXLM:{YXLM_ISSUER}".upper()

    def test_different_issuers_produce_different_keys(self):
        key1 = make_asset_key("USDC", USDC_ISSUER)
        key2 = make_asset_key("USDC", USDT_ISSUER)
        assert key1 != key2

    def test_same_issuer_same_key_idempotent(self):
        key1 = make_asset_key("USDC", USDC_ISSUER)
        key2 = make_asset_key("USDC", USDC_ISSUER)
        assert key1 == key2


# ---------------------------------------------------------------------------
# 2. parse_asset_key
# ---------------------------------------------------------------------------

class TestParseAssetKey:
    def test_native_key(self):
        code, issuer = parse_asset_key("XLM")
        assert code == "XLM"
        assert issuer is None

    def test_non_native_key(self):
        key = f"USDC:{USDC_ISSUER}"
        code, issuer = parse_asset_key(key)
        assert code == "USDC"
        assert issuer == USDC_ISSUER

    def test_unknown_issuer_returns_none(self):
        _, issuer = parse_asset_key("USDC:unknown")
        assert issuer is None

    def test_empty_key_raises(self):
        with pytest.raises(ValueError):
            parse_asset_key("")

    def test_roundtrip_native(self):
        key = make_asset_key("XLM")
        code, issuer = parse_asset_key(key)
        assert make_asset_key(code, issuer) == key

    def test_roundtrip_non_native(self):
        key = make_asset_key("USDC", USDC_ISSUER)
        code, issuer = parse_asset_key(key)
        assert make_asset_key(code, issuer) == key

    def test_whitespace_stripped_on_parse(self):
        code, issuer = parse_asset_key(f"  USDC:{USDC_ISSUER}  ")
        assert code == "USDC"

    def test_bare_ticker_treated_as_native_like(self):
        code, issuer = parse_asset_key("BTC")
        assert code == "BTC"
        assert issuer is None


# ---------------------------------------------------------------------------
# 3. normalize_asset_dict
# ---------------------------------------------------------------------------

class TestNormalizeAssetDict:
    def test_adds_asset_key_native(self):
        d = {"asset_code": "XLM", "asset_issuer": None, "value": 42.0}
        result = normalize_asset_dict(d)
        assert result["asset_key"] == "XLM"
        assert result["value"] == 42.0  # other fields preserved

    def test_adds_asset_key_non_native(self):
        d = {"asset_code": "USDC", "asset_issuer": USDC_ISSUER}
        result = normalize_asset_dict(d)
        assert result["asset_key"] == f"USDC:{USDC_ISSUER}"

    def test_does_not_mutate_original(self):
        d = {"asset_code": "XLM", "asset_issuer": None}
        normalize_asset_dict(d)
        assert "asset_key" not in d

    def test_missing_issuer_uses_unknown(self):
        d = {"asset_code": "USDC", "asset_issuer": None}
        result = normalize_asset_dict(d, allow_no_issuer=True)
        assert result["asset_key"] == "USDC:unknown"

    def test_missing_asset_code_raises(self):
        with pytest.raises(KeyError):
            normalize_asset_dict({"asset_issuer": USDC_ISSUER})

    def test_extra_fields_are_preserved(self):
        d = {
            "asset_code": "XLM",
            "asset_issuer": None,
            "price_usd": 0.12,
            "source": "coingecko",
        }
        result = normalize_asset_dict(d)
        assert result["price_usd"] == 0.12
        assert result["source"] == "coingecko"


# ---------------------------------------------------------------------------
# 4. AssetID dataclass
# ---------------------------------------------------------------------------

class TestAssetID:
    def test_native_asset(self):
        a = AssetID(code="XLM")
        assert a.key == "XLM"
        assert a.is_native
        assert a.issuer is None

    def test_native_with_issuer_normalised(self):
        # Passing an issuer for XLM is silently normalised away
        a = AssetID(code="XLM", issuer="SOME_ISSUER")
        assert a.issuer is None
        assert a.key == "XLM"

    def test_non_native_asset(self):
        a = AssetID(code="USDC", issuer=USDC_ISSUER)
        assert a.key == f"USDC:{USDC_ISSUER}"
        assert not a.is_native

    def test_display_returns_code(self):
        a = AssetID(code="USDC", issuer=USDC_ISSUER)
        assert a.display == "USDC"

    def test_to_dict_contains_all_fields(self):
        a = AssetID(code="USDC", issuer=USDC_ISSUER)
        d = a.to_dict()
        assert d["asset_code"] == "USDC"
        assert d["asset_issuer"] == USDC_ISSUER
        assert d["asset_key"] == f"USDC:{USDC_ISSUER}"

    def test_from_key_native(self):
        a = AssetID.from_key("XLM")
        assert a.code == "XLM"
        assert a.issuer is None

    def test_from_key_non_native(self):
        a = AssetID.from_key(f"USDC:{USDC_ISSUER}")
        assert a.code == "USDC"
        assert a.issuer == USDC_ISSUER

    def test_from_dict_with_asset_key(self):
        d = {"asset_key": f"USDC:{USDC_ISSUER}"}
        a = AssetID.from_dict(d)
        assert a.code == "USDC"
        assert a.issuer == USDC_ISSUER

    def test_from_dict_with_code_and_issuer(self):
        d = {"asset_code": "USDC", "asset_issuer": USDC_ISSUER}
        a = AssetID.from_dict(d)
        assert a.key == f"USDC:{USDC_ISSUER}"

    def test_equality_same_asset(self):
        a1 = AssetID(code="USDC", issuer=USDC_ISSUER)
        a2 = AssetID(code="usdc", issuer=USDC_ISSUER)
        assert a1 == a2

    def test_inequality_different_issuer(self):
        a1 = AssetID(code="USDC", issuer=USDC_ISSUER)
        a2 = AssetID(code="USDC", issuer=USDT_ISSUER)
        assert a1 != a2

    def test_frozen_immutable(self):
        a = AssetID(code="XLM")
        with pytest.raises((AttributeError, TypeError)):
            a.code = "BTC"  # type: ignore[misc]

    def test_str_returns_key(self):
        a = AssetID(code="XLM")
        assert str(a) == "XLM"

    def test_empty_code_raises(self):
        with pytest.raises(ValueError):
            AssetID(code="")

    def test_hashable_usable_as_dict_key(self):
        a = AssetID(code="XLM")
        d = {a: "native"}
        assert d[AssetID(code="XLM")] == "native"


# ---------------------------------------------------------------------------
# 5. display_name helper
# ---------------------------------------------------------------------------

class TestDisplayName:
    def test_native(self):
        assert display_name("XLM") == "XLM"

    def test_non_native(self):
        assert display_name(f"USDC:{USDC_ISSUER}") == "USDC"

    def test_unknown_issuer(self):
        assert display_name("USDC:unknown") == "USDC"


# ---------------------------------------------------------------------------
# 6. KNOWN_ASSETS registry
# ---------------------------------------------------------------------------

class TestKnownAssets:
    def test_xlm_present(self):
        assert "XLM" in KNOWN_ASSETS
        assert KNOWN_ASSETS["XLM"].is_native

    def test_usdc_has_issuer(self):
        assert KNOWN_ASSETS["USDC"].issuer == USDC_ISSUER

    def test_known_asset_keys_are_canonical(self):
        for name, asset in KNOWN_ASSETS.items():
            key = asset.key
            code, issuer = parse_asset_key(key)
            assert make_asset_key(code, issuer, allow_no_issuer=True) == key


# ---------------------------------------------------------------------------
# 7. No issuer-loss in UI-facing fields
# ---------------------------------------------------------------------------

class TestNoIssuerLoss:
    """
    Acceptance criterion: issuer must survive the full
    raw-dict → AssetID → canonical-key → parse roundtrip.
    """

    def test_issuer_survives_roundtrip_via_key(self):
        original = {"asset_code": "USDC", "asset_issuer": USDC_ISSUER}
        enriched = normalize_asset_dict(original)
        _, recovered_issuer = parse_asset_key(enriched["asset_key"])
        assert recovered_issuer == USDC_ISSUER

    def test_issuer_survives_asset_id_roundtrip(self):
        a = AssetID(code="USDC", issuer=USDC_ISSUER)
        recovered = AssetID.from_key(a.key)
        assert recovered.issuer == USDC_ISSUER

    def test_display_name_does_not_lose_issuer_from_key(self):
        key = f"USDC:{USDC_ISSUER}"
        # display_name returns code only, but key still carries issuer
        assert display_name(key) == "USDC"
        _, issuer = parse_asset_key(key)
        assert issuer == USDC_ISSUER   # issuer still recoverable from key

    def test_to_dict_preserves_issuer(self):
        a = AssetID(code="USDC", issuer=USDC_ISSUER)
        d = a.to_dict()
        assert d["asset_issuer"] == USDC_ISSUER

    def test_two_assets_same_code_different_issuer_not_conflated(self):
        key1 = make_asset_key("USDC", USDC_ISSUER)
        key2 = make_asset_key("USDC", USDT_ISSUER)
        assert key1 != key2
        _, i1 = parse_asset_key(key1)
        _, i2 = parse_asset_key(key2)
        assert i1 != i2