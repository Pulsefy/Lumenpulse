"""
Regression tests for asset issuer normalization.

Loads the QA dataset from data/asset_issuer_normalization_qa.json and
parametrizes tests across all entries, validating that normalize_asset()
produces the correct canonical output for each case.

Run with:
    cd apps/data-processing
    pytest tests/test_asset_normalizer.py -v
"""

import json
import os
import sys
import pytest

# Add src to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from utils.asset_normalizer import (
    NormalizedAsset,
    AssetNormalizationError,
    normalize_asset,
    _is_native_alias,
    _validate_issuer,
    _validate_asset_code,
)


# ---------------------------------------------------------------------------
# Fixtures: load QA dataset
# ---------------------------------------------------------------------------

QA_DATASET_PATH = os.path.join(
    os.path.dirname(__file__), "..", "data", "asset_issuer_normalization_qa.json"
)


def _load_qa_dataset():
    """Load the full QA dataset from the JSON file."""
    with open(QA_DATASET_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data["test_cases"]


def _coerce_input(raw_input, input_type):
    """
    Coerce the raw_input from JSON into the correct Python type.
    JSON cannot represent tuples, so tuple inputs are stored as arrays.
    """
    if input_type == "tuple":
        return tuple(raw_input)
    return raw_input


# Pre-load dataset at module level for parametrization
_ALL_CASES = _load_qa_dataset()
_SUCCESS_CASES = [c for c in _ALL_CASES if c["should_succeed"]]
_FAILURE_CASES = [c for c in _ALL_CASES if not c["should_succeed"]]


# ---------------------------------------------------------------------------
# Dataset-driven parametrized tests
# ---------------------------------------------------------------------------


class TestNormalizationQADataset:
    """
    Regression tests driven by the asset_issuer_normalization_qa.json dataset.
    Each test case in the dataset is run as a separate parametrized test.
    """

    @pytest.mark.parametrize(
        "case",
        _SUCCESS_CASES,
        ids=[c["test_id"] for c in _SUCCESS_CASES],
    )
    def test_successful_normalization(self, case):
        """Verify that valid inputs produce the expected canonical output."""
        raw_input = _coerce_input(case["raw_input"], case["input_type"])
        expected = case["expected_output"]

        result = normalize_asset(raw_input)

        assert isinstance(result, NormalizedAsset), (
            f"[{case['test_id']}] Expected NormalizedAsset, got {type(result)}"
        )
        assert result.asset_type == expected["asset_type"], (
            f"[{case['test_id']}] asset_type mismatch: "
            f"got '{result.asset_type}', expected '{expected['asset_type']}'"
        )
        assert result.asset_code == expected["asset_code"], (
            f"[{case['test_id']}] asset_code mismatch: "
            f"got '{result.asset_code}', expected '{expected['asset_code']}'"
        )
        assert result.asset_issuer == expected["asset_issuer"], (
            f"[{case['test_id']}] asset_issuer mismatch: "
            f"got '{result.asset_issuer}', expected '{expected['asset_issuer']}'"
        )
        assert result.canonical == expected["canonical"], (
            f"[{case['test_id']}] canonical mismatch: "
            f"got '{result.canonical}', expected '{expected['canonical']}'"
        )

    @pytest.mark.parametrize(
        "case",
        _FAILURE_CASES,
        ids=[c["test_id"] for c in _FAILURE_CASES],
    )
    def test_failed_normalization(self, case):
        """Verify that invalid inputs raise AssetNormalizationError."""
        raw_input = _coerce_input(case["raw_input"], case["input_type"])

        with pytest.raises(AssetNormalizationError):
            normalize_asset(raw_input)


# ---------------------------------------------------------------------------
# Unit tests for normalizer internals
# ---------------------------------------------------------------------------


class TestNativeAliasDetection:
    """Tests for _is_native_alias helper."""

    @pytest.mark.parametrize(
        "alias",
        ["xlm", "XLM", "Xlm", "native", "NATIVE", "lumens", "lumen", "stellar"],
    )
    def test_recognized_aliases(self, alias):
        assert _is_native_alias(alias) is True

    @pytest.mark.parametrize(
        "non_alias",
        ["USDC", "btc", "ETH", "xlm1", "nativ", ""],
    )
    def test_non_aliases(self, non_alias):
        assert _is_native_alias(non_alias) is False


class TestIssuerValidation:
    """Tests for _validate_issuer helper."""

    def test_valid_issuer(self):
        issuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
        assert _validate_issuer(issuer) == issuer

    def test_lowercase_issuer_uppercased(self):
        issuer = "ga5zsejyb37jrc5avcia5mop4rhtm335x2kgx3ihojapp5re34k4kzvn"
        expected = issuer.upper()
        assert _validate_issuer(issuer) == expected

    def test_issuer_with_whitespace_stripped(self):
        issuer = "  GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN  "
        assert _validate_issuer(issuer) == issuer.strip()

    def test_short_issuer_rejected(self):
        with pytest.raises(AssetNormalizationError):
            _validate_issuer("GA5ZSEJYB37JRC5AVC")

    def test_wrong_prefix_rejected(self):
        with pytest.raises(AssetNormalizationError):
            _validate_issuer(
                "XA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
            )

    def test_empty_issuer_rejected(self):
        with pytest.raises(AssetNormalizationError):
            _validate_issuer("")


class TestAssetCodeValidation:
    """Tests for _validate_asset_code helper."""

    @pytest.mark.parametrize("code", ["USDC", "xlm", "X", "BANANACOIN12"])
    def test_valid_codes(self, code):
        result = _validate_asset_code(code)
        assert result == code.strip().upper()

    def test_empty_code_rejected(self):
        with pytest.raises(AssetNormalizationError):
            _validate_asset_code("")

    def test_too_long_code_rejected(self):
        with pytest.raises(AssetNormalizationError):
            _validate_asset_code("LONGASSETCODE99")

    def test_special_chars_rejected(self):
        with pytest.raises(AssetNormalizationError):
            _validate_asset_code("US$C")


class TestNormalizedAssetDataclass:
    """Tests for the NormalizedAsset dataclass."""

    def test_to_dict(self):
        asset = NormalizedAsset(
            asset_type="native",
            asset_code="XLM",
            asset_issuer=None,
            canonical="native",
        )
        d = asset.to_dict()
        assert d == {
            "asset_type": "native",
            "asset_code": "XLM",
            "asset_issuer": None,
            "canonical": "native",
        }

    def test_frozen(self):
        """NormalizedAsset should be immutable."""
        asset = NormalizedAsset(
            asset_type="native",
            asset_code="XLM",
            asset_issuer=None,
            canonical="native",
        )
        with pytest.raises(AttributeError):
            asset.asset_code = "BTC"

    def test_equality(self):
        """Two NormalizedAssets with same fields should be equal."""
        a = NormalizedAsset("native", "XLM", None, "native")
        b = NormalizedAsset("native", "XLM", None, "native")
        assert a == b


class TestNormalizeAssetAPI:
    """Tests for the top-level normalize_asset() function."""

    def test_none_input_raises(self):
        with pytest.raises(AssetNormalizationError, match="None"):
            normalize_asset(None)

    def test_unsupported_type_raises(self):
        with pytest.raises(AssetNormalizationError, match="Unsupported input type"):
            normalize_asset(42)  # type: ignore[arg-type]

    def test_native_string(self):
        result = normalize_asset("XLM")
        assert result.canonical == "native"
        assert result.asset_type == "native"

    def test_issued_string_colon(self):
        result = normalize_asset(
            "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
        )
        assert result.asset_type == "credit_alphanum4"
        assert result.asset_code == "USDC"
        assert result.canonical == (
            "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
        )

    def test_issued_dict(self):
        result = normalize_asset({
            "asset_code": "AQUA",
            "asset_issuer": "GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA",
        })
        assert result.asset_code == "AQUA"
        assert result.canonical == (
            "AQUA:GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA"
        )

    def test_issued_tuple(self):
        result = normalize_asset(
            ("USDC", "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN")
        )
        assert result.asset_code == "USDC"
        assert result.asset_type == "credit_alphanum4"

    def test_list_treated_as_tuple(self):
        result = normalize_asset(
            ["USDC", "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"]
        )
        assert result.asset_code == "USDC"

    def test_alphanum12_detection(self):
        result = normalize_asset(
            "BANANACOIN12:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
        )
        assert result.asset_type == "credit_alphanum12"
        assert result.asset_code == "BANANACOIN12"


# ---------------------------------------------------------------------------
# Dataset integrity test
# ---------------------------------------------------------------------------


class TestQADatasetIntegrity:
    """Validate the structure and integrity of the QA dataset file itself."""

    def test_dataset_loads(self):
        """Dataset JSON file must be loadable."""
        cases = _load_qa_dataset()
        assert isinstance(cases, list)
        assert len(cases) > 0

    def test_minimum_case_count(self):
        """Dataset must have at least 30 test cases."""
        cases = _load_qa_dataset()
        assert len(cases) >= 30, f"Expected >=30 cases, got {len(cases)}"

    def test_unique_test_ids(self):
        """All test_id values must be unique."""
        cases = _load_qa_dataset()
        ids = [c["test_id"] for c in cases]
        assert len(ids) == len(set(ids)), f"Duplicate test IDs found: {ids}"

    def test_required_fields(self):
        """Every test case must have all required fields."""
        required = {"test_id", "category", "description", "raw_input",
                     "input_type", "expected_output", "should_succeed"}
        cases = _load_qa_dataset()
        for case in cases:
            missing = required - set(case.keys())
            assert not missing, (
                f"Case '{case.get('test_id', '?')}' missing fields: {missing}"
            )

    def test_category_coverage(self):
        """Dataset must cover native, issued, edge_case, and malformed categories."""
        cases = _load_qa_dataset()
        categories = {c["category"] for c in cases}
        expected_categories = {"native", "issued", "edge_case", "malformed"}
        missing = expected_categories - categories
        assert not missing, f"Missing categories: {missing}"

    def test_has_success_and_failure_cases(self):
        """Dataset must contain both success and failure test cases."""
        cases = _load_qa_dataset()
        successes = [c for c in cases if c["should_succeed"]]
        failures = [c for c in cases if not c["should_succeed"]]
        assert len(successes) > 0, "No success cases in dataset"
        assert len(failures) > 0, "No failure cases in dataset"
