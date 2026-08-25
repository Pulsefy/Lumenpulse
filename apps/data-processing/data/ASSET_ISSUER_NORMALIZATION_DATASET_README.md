# Asset Issuer Normalization QA Dataset

## Overview

This dataset provides validation test cases for issuer-aware asset normalization in the Lumenpulse data processing pipeline. It ensures that asset normalization logic correctly handles both native assets (like XLM with no issuer) and issued assets (with specific issuer addresses).

## Purpose

The validation dataset serves as a regression test suite to:
- Ensure asset normalization stays correct across code changes
- Validate handling of native vs. issued assets
- Test edge cases (case sensitivity, whitespace, null values)
- Provide a reference for expected canonical forms

## Dataset Structure

The dataset is stored in `asset_issuer_normalization_dataset.json` with the following structure:

```json
{
  "schema_version": 1,
  "description": "Validation dataset for issuer-aware asset normalization...",
  "last_updated": "2026-06-29T23:00:00Z",
  "test_cases": [
    {
      "id": "unique_test_case_id",
      "description": "Human-readable description",
      "input": {
        "asset_code": "XLM",
        "asset_issuer": null,
        "asset_type": "native"
      },
      "expected_canonical": {
        "asset_code": "XLM",
        "asset_issuer": null,
        "canonical_form": "XLM-native",
        "is_native": true
      }
    }
  ]
}
```

## Test Case Types

### Native Assets
Native assets (like XLM) have no issuer (`asset_issuer: null` or empty string). Their canonical form ends with `-native`.

**Examples:**
- `XLM-native` - Native Stellar Lumens
- Case variations: `xlm`, `XLM` should all normalize to `XLM-native`

### Issued Assets
Issued assets have a specific issuer address (56-character Stellar public key). Their canonical form includes the issuer.

**Examples:**
- `USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3I4OZU3D7QDNZMP4J2T` - Circle USDC
- `USDT-GDRXBYQKJGKJGRK7GPBL7BKXWNVBDOCXGZVQOZT7Y7V7MUQGEOUP7OIA` - Tether USDT

### Edge Cases
The dataset includes edge cases to test robustness:
- **Case sensitivity**: Asset codes should normalize to uppercase
- **Whitespace**: Issuer addresses should be trimmed
- **Null/empty values**: Proper handling of missing issuers
- **Mixed case codes**: `UsDc` → `USDC`
- **Empty issuer for native**: `""` should be treated as `null`

## Normalization Rules

### Asset Code Normalization
1. Trim whitespace
2. Convert to uppercase
3. Return empty string if input is null or empty

### Asset Issuer Normalization
1. Trim whitespace
2. Return `null` if input is null, empty, or whitespace-only
3. Otherwise return trimmed address

### Canonical Form Generation
- Native assets: `{ASSET_CODE}-native`
- Issued assets: `{ASSET_CODE}-{ISSUER_ADDRESS}`

### Native Asset Detection
An asset is considered native if:
- `asset_issuer` is `null`, OR
- `asset_issuer` is an empty string after trimming

## Adding New Test Cases

To add a new test case to the dataset:

1. Open `asset_issuer_normalization_dataset.json`
2. Add a new entry to the `test_cases` array:
```json
{
  "id": "descriptive_id",
  "description": "What this test case validates",
  "input": {
    "asset_code": "CODE",
    "asset_issuer": "ISSUER_ADDRESS_OR_NULL",
    "asset_type": "native_or_credit_alphanum4"
  },
  "expected_canonical": {
    "asset_code": "NORMALIZED_CODE",
    "asset_issuer": "NORMALIZED_ISSUER_OR_NULL",
    "canonical_form": "EXPECTED_CANONICAL_FORM",
    "is_native": true_or_false
  }
}
```
3. Update the `last_updated` timestamp
4. Run the test suite to validate

## Running Tests

The test suite is located in `tests/test_asset_issuer_normalization.py`.

Run all normalization tests:
```bash
cd apps/data-processing
pytest tests/test_asset_issuer_normalization.py -v
```

Run specific test categories:
```bash
# Test only native asset cases
pytest tests/test_asset_issuer_normalization.py::TestAssetIssuerNormalization::test_native_asset_variations -v

# Test only issued asset cases
pytest tests/test_asset_issuer_normalization.py::TestAssetIssuerNormalization::test_issued_asset_variations -v

# Test case sensitivity
pytest tests/test_asset_issuer_normalization.py::TestAssetIssuerNormalization::test_case_sensitivity_normalization -v
```

## Integration with CI

The normalization tests are part of the data processing CI pipeline. They run automatically on:
- Pull requests
- Main branch commits
- Scheduled regression tests

## Maintenance

### When to Update the Dataset
- Adding support for new asset types
- Changing normalization logic
- Fixing bugs in asset handling
- Adding new edge cases discovered in production

### Versioning
- Update `schema_version` when making breaking changes to the dataset structure
- Update `last_updated` timestamp when adding/modifying test cases
- Document breaking changes in this README

### Review Process
Before committing dataset changes:
1. Ensure all tests pass
2. Verify new test cases cover the intended scenario
3. Check for duplicate or redundant test cases
4. Update documentation if adding new test case types

## Common Issues

### Test Fails After Code Changes
If normalization tests fail after code changes:
1. Review the failing test case
2. Determine if the change is intentional (normalization logic changed) or a bug
3. If intentional: Update the dataset with new expected values
4. If unintentional: Fix the code to match expected behavior

### Adding Real Issuer Addresses
When adding real issuer addresses:
- Verify they are valid Stellar public keys (56 characters, base32)
- Use addresses from trusted issuers (Circle, Tether, etc.)
- Document the issuer in the test case description

## Related Files

- `data/asset_issuer_normalization_dataset.json` - The validation dataset
- `tests/test_asset_issuer_normalization.py` - Test suite
- `src/ingestion/price_fetcher.py` - Price fetching with asset issuer support
- `src/ingestion/stellar_fetcher.py` - Stellar data fetching with asset handling

## References

- [Stellar Asset Documentation](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-assets/)
- [Stellar Asset Issuance](https://developers.stellar.org/docs/tutorials/assets/)
- [Issue #875](https://github.com/sheyman546/Lumenpulse/issues/875) - Original issue for this dataset
