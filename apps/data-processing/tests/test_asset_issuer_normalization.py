"""
Unit tests for asset issuer normalization using the validation dataset.

This test suite ensures that issuer-aware asset normalization stays correct
by validating against the expected canonical forms in the QA dataset.
"""

import json
import os
import sys
from pathlib import Path
from typing import Dict, Any, Optional

import pytest

# Add the src directory to the Python path
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))


def load_normalization_dataset() -> Dict[str, Any]:
    """Load the asset issuer normalization validation dataset."""
    dataset_path = Path(__file__).parent.parent / "data" / "asset_issuer_normalization_dataset.json"
    if not dataset_path.exists():
        pytest.skip(f"Normalization dataset not found at {dataset_path}")
    
    with open(dataset_path, "r", encoding="utf-8") as f:
        return json.load(f)


def normalize_asset_code(asset_code: Optional[str]) -> str:
    """
    Normalize asset code to uppercase.
    
    Args:
        asset_code: The asset code to normalize (can be None, empty, or any case)
    
    Returns:
        Normalized uppercase asset code, or empty string if input is None/empty
    """
    if not asset_code:
        return ""
    return asset_code.strip().upper()


def normalize_asset_issuer(asset_issuer: Optional[str]) -> Optional[str]:
    """
    Normalize asset issuer address.
    
    Args:
        asset_issuer: The asset issuer address to normalize (can be None or empty)
    
    Returns:
        Normalized issuer address (trimmed whitespace), or None if input is None/empty
    """
    if not asset_issuer:
        return None
    trimmed = asset_issuer.strip()
    return trimmed if trimmed else None


def get_canonical_form(asset_code: str, asset_issuer: Optional[str]) -> str:
    """
    Generate canonical form for an asset.
    
    Args:
        asset_code: The normalized asset code
        asset_issuer: The normalized asset issuer (None for native assets)
    
    Returns:
        Canonical form string (e.g., "XLM-native" or "USDC-GA5ZSE...")
    """
    if asset_issuer is None:
        return f"{asset_code}-native"
    return f"{asset_code}-{asset_issuer}"


def is_native_asset(asset_issuer: Optional[str]) -> bool:
    """
    Determine if an asset is native based on issuer.
    
    Args:
        asset_issuer: The asset issuer address
    
    Returns:
        True if the asset is native (issuer is None or empty), False otherwise
    """
    return asset_issuer is None or asset_issuer == ""


class TestAssetIssuerNormalization:
    """Test suite for asset issuer normalization using the validation dataset."""
    
    @pytest.fixture(autouse=True)
    def setup_dataset(self):
        """Load the normalization dataset before each test."""
        self.dataset = load_normalization_dataset()
        self.test_cases = self.dataset.get("test_cases", [])
    
    def test_dataset_exists_and_valid(self):
        """Test that the dataset file exists and has valid structure."""
        assert "schema_version" in self.dataset
        assert "test_cases" in self.dataset
        assert isinstance(self.test_cases, list)
        assert len(self.test_cases) > 0
    
    def test_all_test_cases_have_required_fields(self):
        """Test that all test cases have required fields."""
        required_fields = ["id", "description", "input", "expected_canonical"]
        
        for case in self.test_cases:
            for field in required_fields:
                assert field in case, f"Test case {case.get('id')} missing field: {field}"
    
    def test_normalize_asset_code(self):
        """Test asset code normalization function."""
        test_cases = [
            ("XLM", "XLM"),
            ("xlm", "XLM"),
            ("UsDc", "USDC"),
            ("usdc", "USDC"),
            ("", ""),
            (None, ""),
            ("  XLM  ", "XLM"),
        ]
        
        for input_code, expected in test_cases:
            result = normalize_asset_code(input_code)
            assert result == expected, f"Expected {expected} for input {input_code}, got {result}"
    
    def test_normalize_asset_issuer(self):
        """Test asset issuer normalization function."""
        test_cases = [
            (None, None),
            ("", None),
            ("  ", None),
            ("GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3I4OZU3D7QDNZMP4J2T", "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3I4OZU3D7QDNZMP4J2T"),
            ("  GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3I4OZU3D7QDNZMP4J2T  ", "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3I4OZU3D7QDNZMP4J2T"),
        ]
        
        for input_issuer, expected in test_cases:
            result = normalize_asset_issuer(input_issuer)
            assert result == expected, f"Expected {expected} for input {input_issuer}, got {result}"
    
    def test_get_canonical_form(self):
        """Test canonical form generation."""
        test_cases = [
            ("XLM", None, "XLM-native"),
            ("USDC", "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3I4OZU3D7QDNZMP4J2T", "USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3I4OZU3D7QDNZMP4J2T"),
            ("BTC", "GBD5AF4S7JQKZODA7KX2LL7FQKBTJHYEYJ6K7Z3L5Y7V7MUQGEOUP7OIA", "BTC-GBD5AF4S7JQKZODA7KX2LL7FQKBTJHYEYJ6K7Z3L5Y7V7MUQGEOUP7OIA"),
        ]
        
        for asset_code, asset_issuer, expected in test_cases:
            result = get_canonical_form(asset_code, asset_issuer)
            assert result == expected, f"Expected {expected}, got {result}"
    
    def test_is_native_asset(self):
        """Test native asset detection."""
        test_cases = [
            (None, True),
            ("", True),
            ("GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3I4OZU3D7QDNZMP4J2T", False),
        ]
        
        for asset_issuer, expected in test_cases:
            result = is_native_asset(asset_issuer)
            assert result == expected, f"Expected {expected} for issuer {asset_issuer}, got {result}"
    
    def test_dataset_normalization_validation(self):
        """Test that all dataset test cases pass normalization validation."""
        for case in self.test_cases:
            test_id = case["id"]
            input_data = case["input"]
            expected = case["expected_canonical"]
            
            # Normalize the input
            normalized_code = normalize_asset_code(input_data.get("asset_code"))
            normalized_issuer = normalize_asset_issuer(input_data.get("asset_issuer"))
            
            # Generate canonical form
            canonical = get_canonical_form(normalized_code, normalized_issuer)
            
            # Check if native
            is_native = is_native_asset(normalized_issuer)
            
            # Validate against expected
            assert normalized_code == expected["asset_code"], \
                f"Test case {test_id}: Expected asset_code {expected['asset_code']}, got {normalized_code}"
            
            assert normalized_issuer == expected["asset_issuer"], \
                f"Test case {test_id}: Expected asset_issuer {expected['asset_issuer']}, got {normalized_issuer}"
            
            assert canonical == expected["canonical_form"], \
                f"Test case {test_id}: Expected canonical_form {expected['canonical_form']}, got {canonical}"
            
            assert is_native == expected["is_native"], \
                f"Test case {test_id}: Expected is_native {expected['is_native']}, got {is_native}"
    
    def test_native_asset_variations(self):
        """Test various representations of native XLM."""
        native_cases = [case for case in self.test_cases if case["expected_canonical"]["is_native"]]
        
        assert len(native_cases) > 0, "Dataset should contain native asset test cases"
        
        for case in native_cases:
            input_data = case["input"]
            expected = case["expected_canonical"]
            
            normalized_code = normalize_asset_code(input_data.get("asset_code"))
            normalized_issuer = normalize_asset_issuer(input_data.get("asset_issuer"))
            
            # Native assets should have None issuer
            assert normalized_issuer is None, \
                f"Test case {case['id']}: Native asset should have None issuer"
            
            # Canonical form should end with -native
            canonical = get_canonical_form(normalized_code, normalized_issuer)
            assert canonical.endswith("-native"), \
                f"Test case {case['id']}: Native asset canonical form should end with -native"
    
    def test_issued_asset_variations(self):
        """Test various representations of issued assets."""
        issued_cases = [case for case in self.test_cases if not case["expected_canonical"]["is_native"]]
        
        assert len(issued_cases) > 0, "Dataset should contain issued asset test cases"
        
        for case in issued_cases:
            input_data = case["input"]
            expected = case["expected_canonical"]
            
            normalized_code = normalize_asset_code(input_data.get("asset_code"))
            normalized_issuer = normalize_asset_issuer(input_data.get("asset_issuer"))
            
            # Issued assets should have a non-None issuer
            assert normalized_issuer is not None, \
                f"Test case {case['id']}: Issued asset should have non-None issuer"
            
            # Canonical form should not end with -native
            canonical = get_canonical_form(normalized_code, normalized_issuer)
            assert not canonical.endswith("-native"), \
                f"Test case {case['id']}: Issued asset canonical form should not end with -native"
            
            # Canonical form should contain the issuer
            assert normalized_issuer in canonical, \
                f"Test case {case['id']}: Canonical form should contain issuer address"
    
    def test_case_sensitivity_normalization(self):
        """Test that case variations normalize correctly."""
        case_sensitivity_cases = [
            case for case in self.test_cases 
            if "lowercase" in case["id"] or "uppercase" in case["id"] or "mixed" in case["id"]
        ]
        
        for case in case_sensitivity_cases:
            input_data = case["input"]
            expected = case["expected_canonical"]
            
            normalized_code = normalize_asset_code(input_data.get("asset_code"))
            
            # All asset codes should be uppercase after normalization
            assert normalized_code == normalized_code.upper(), \
                f"Test case {case['id']}: Normalized code should be uppercase"
            
            assert normalized_code == expected["asset_code"], \
                f"Test case {case['id']}: Expected {expected['asset_code']}, got {normalized_code}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
