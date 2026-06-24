# Asset Issuer Normalization QA

This document describes the **asset issuer normalization** validation dataset and testing infrastructure for the LumenPulse data-processing module.

## Purpose

In the Stellar ecosystem, assets are identified by their **code + issuer** pair. The native asset (XLM/Lumens) has no issuer, while all issued assets (USDC, yXLM, AQUA, etc.) require a 56-character public key to uniquely identify the issuing account.

This QA infrastructure ensures that the `normalize_asset()` function correctly and consistently converts messy, variant asset inputs into a **canonical normalized form**—and that regressions are caught automatically when the normalization logic changes.

## Canonical Form Specification

| Asset Kind | `asset_type` | `asset_code` | `asset_issuer` | `canonical` |
|---|---|---|---|---|
| **Native** (XLM) | `"native"` | `"XLM"` | `null` | `"native"` |
| **Issued** (≤4 chars) | `"credit_alphanum4"` | Uppercase code | 56-char G-address | `"CODE:ISSUER"` |
| **Issued** (5-12 chars) | `"credit_alphanum12"` | Uppercase code | 56-char G-address | `"CODE:ISSUER"` |

### Accepted Input Formats

The normalizer accepts three input types:

- **String**: `"XLM"`, `"native"`, `"USDC:GABCD..."`, `"USDC-GABCD..."`
- **Dict**: `{"asset_code": "USDC", "asset_issuer": "GABCD..."}` (also supports `code`/`issuer` shorthand keys)
- **Tuple**: `("USDC", "GABCD...")` or `("XLM",)` for native

### Recognized Native Aliases

The following strings (case-insensitive) are treated as the native asset:
`xlm`, `native`, `lumens`, `lumen`, `stellar`

## File Locations

| File | Path | Description |
|---|---|---|
| Normalizer module | `src/utils/asset_normalizer.py` | Core normalization logic |
| QA dataset | `data/asset_issuer_normalization_qa.json` | 40 test cases in JSON |
| Regression tests | `tests/test_asset_normalizer.py` | Pytest suite (dataset-driven + unit) |

## Dataset Schema

The QA dataset is a JSON file with the following structure:

```json
{
  "metadata": { ... },
  "test_cases": [
    {
      "test_id": "native_001",
      "category": "native | issued | edge_case | malformed",
      "description": "Human-readable description",
      "raw_input": "XLM",
      "input_type": "string | dict | tuple",
      "expected_output": {
        "asset_type": "native",
        "asset_code": "XLM",
        "asset_issuer": null,
        "canonical": "native"
      },
      "should_succeed": true
    }
  ]
}
```

### Field Reference

| Field | Type | Description |
|---|---|---|
| `test_id` | string | Unique identifier, prefixed by category (e.g., `native_001`, `issued_003`) |
| `category` | string | One of: `native`, `issued`, `edge_case`, `malformed` |
| `description` | string | What this test case validates |
| `raw_input` | any | The input to pass to `normalize_asset()`. For tuples, stored as JSON arrays |
| `input_type` | string | Python type: `"string"`, `"dict"`, or `"tuple"` |
| `expected_output` | object\|null | Expected `NormalizedAsset` fields, or `null` if `should_succeed` is `false` |
| `should_succeed` | boolean | `true` if normalization should succeed, `false` if it should raise an error |

## Running the Tests

From the `apps/data-processing/` directory:

```bash
# Run all normalization tests (verbose)
pytest tests/test_asset_normalizer.py -v

# Run only dataset-driven tests
pytest tests/test_asset_normalizer.py -v -k "TestNormalizationQADataset"

# Run only success cases
pytest tests/test_asset_normalizer.py -v -k "test_successful_normalization"

# Run only failure cases
pytest tests/test_asset_normalizer.py -v -k "test_failed_normalization"

# Run dataset integrity checks
pytest tests/test_asset_normalizer.py -v -k "TestQADatasetIntegrity"
```

## Adding New Test Cases

To add a new test case to the QA dataset:

1. **Open** `data/asset_issuer_normalization_qa.json`
2. **Append** a new entry to the `test_cases` array with all required fields
3. **Assign a unique `test_id`** following the naming convention:
   - `native_NNN` — for native asset variants
   - `issued_NNN` — for issued asset scenarios
   - `edge_NNN` — for edge cases and boundary conditions
   - `malformed_NNN` — for inputs that should be rejected
4. **Run the tests** to verify your new case:
   ```bash
   pytest tests/test_asset_normalizer.py -v -k "<your_test_id>"
   ```
5. **Check dataset integrity** passes:
   ```bash
   pytest tests/test_asset_normalizer.py -v -k "TestQADatasetIntegrity"
   ```

### Example: Adding a new issued asset test case

```json
{
  "test_id": "issued_013",
  "category": "issued",
  "description": "EURC (Euro Coin) with Circle issuer via dict",
  "raw_input": {
    "asset_code": "EURC",
    "asset_issuer": "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP"
  },
  "input_type": "dict",
  "expected_output": {
    "asset_type": "credit_alphanum4",
    "asset_code": "EURC",
    "asset_issuer": "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP",
    "canonical": "EURC:GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP"
  },
  "should_succeed": true
}
```

## Using the Normalizer in Code

```python
from src.utils.asset_normalizer import normalize_asset, AssetNormalizationError

# Native asset
result = normalize_asset("XLM")
print(result.canonical)  # "native"

# Issued asset
result = normalize_asset("USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN")
print(result.canonical)  # "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
print(result.asset_type) # "credit_alphanum4"

# Error handling
try:
    normalize_asset("USDC")  # Missing issuer
except AssetNormalizationError as e:
    print(f"Error: {e}")
```
