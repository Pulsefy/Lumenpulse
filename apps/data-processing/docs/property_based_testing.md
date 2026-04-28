# Property-Based Testing for Protocol Invariants

This document describes the comprehensive property-based testing implementation for LumenPulse, designed to ensure protocol-level rules are never violated regardless of user input.

## Overview

Property-based testing is a testing methodology that verifies invariants (properties that must always hold true) by generating a wide range of test inputs automatically. Unlike traditional example-based testing, property-based tests can discover edge cases and boundary conditions that manual test cases might miss.

## Implementation Architecture

### Core Components

1. **Test Files**: Organized by protocol domain
   - `test_sentiment_invariants.py` - Sentiment analysis protocol invariants
   - `test_validation_invariants.py` - Data validation protocol invariants  
   - `test_security_invariants.py` - Security protocol invariants
   - `test_database_invariants.py` - Database model invariants

2. **Configuration**: `conftest.py` provides shared fixtures, strategies, and utilities

3. **Test Runner**: `run_property_tests.py` provides comprehensive test execution and reporting

### Technology Stack

- **Hypothesis**: Python property-based testing framework
- **Pytest**: Test runner and integration
- **Pydantic**: Data validation (tested via invariants)
- **SQLAlchemy**: Database models (tested via invariants)

## Protocol Invariants Covered

### 1. Sentiment Analysis Invariants

These invariants ensure the sentiment analysis system maintains mathematical and logical consistency:

#### Score Bounds Invariant
```python
# Sentiment compound scores must always be between -1 and 1
assert -1.0 <= result.compound_score <= 1.0
```

#### Component Sum Invariant  
```python
# Positive, negative, and neutral scores should sum to 1.0
pos + neg + neu ≈ 1.0
```

#### Label Consistency Invariant
```python
# Sentiment labels must be consistent with compound scores
if score >= 0.05: label == "positive"
elif score <= -0.05: label == "negative"  
else: label == "neutral"
```

#### Asset Filter Invariant
```python
# When asset filter is specified, only matching assets are returned
if asset_filter not in text: result == neutral_sentiment
```

#### Batch Analysis Invariant
```python
# Batch analysis results must be consistent with individual analyses
batch_results == [analyze(text) for text in texts]
```

### 2. Data Validation Invariants

These invariants ensure data validation maintains structural integrity:

#### Required Field Invariant
```python
# News articles missing required fields must always be rejected
if missing_required_fields: validation_result == None
```

#### Type Constraint Invariant
```python
# Wrong field types must always be rejected
if wrong_field_types: validation_result == None
```

#### Empty Field Invariant
```python
# Empty strings for required fields must be rejected
if empty_required_fields: validation_result == None
```

#### Robustness Invariant
```python
# Validation should handle malformed data gracefully without crashes
for malformed_input: no_exceptions_raised()
```

### 3. Security Protocol Invariants

These invariants ensure security mechanisms maintain proper enforcement:

#### Rate Limit Format Invariant
```python
# Rate limit strings must follow 'N/(second|minute|hour|day)' pattern
assert matches_regex(r'^\d+/(second|minute|hour|day)$', rate_limit_string)
```

#### API Key Authentication Invariant
```python
# Requests without API keys must always be rejected
if missing_api_key: http_exception_401()
```

#### Credential Validation Invariant
```python
# Incorrect API keys must always be rejected
if wrong_api_key: http_exception_403()
```

#### Case Sensitivity Invariant
```python
# API key validation should be case-sensitive
if case_mismatched_key: authentication_fails()
```

### 4. Database Model Invariants

These invariants ensure database models maintain data integrity:

#### Type Invariant
```python
# Model fields must maintain correct types
assert isinstance(field.field_name, expected_type)
```

#### Value Bounds Invariant
```python
# Numeric fields must stay within defined bounds
assert min_value <= field.value <= max_value
```

#### Length Constraint Invariant
```python
# String fields must not exceed maximum lengths
assert len(field.string_field) <= max_length
```

#### Relationship Consistency Invariant
```python
# Related models should maintain consistent data
shared_fields_should_match_across_models
```

## Usage

### Running All Property-Based Tests

```bash
# Run all property-based tests with default settings
python tests/property_based/run_property_tests.py

# Run with verbose output
python tests/property_based/run_property_tests.py --verbose

# Run with custom number of examples
python tests/property_based/run_property_tests.py --max-examples 500

# Run tests in parallel (requires pytest-xdist)
python tests/property_based/run_property_tests.py --parallel

# Generate report file
python tests/property_based/run_property_tests.py --report report.md

# Run integration tests alongside property tests
python tests/property_based/run_property_tests.py --integration
```

### Running Specific Test Categories

```bash
# Run only sentiment analysis invariants
pytest tests/property_based/test_sentiment_invariants.py -v

# Run only security protocol invariants
pytest tests/property_based/test_security_invariants.py -v

# Run using pytest markers
pytest -m sentiment_invariants -v
pytest -m security_invariants -v
pytest -m property_based -v
```

### Running with pytest directly

```bash
# Run with hypothesis profile
pytest --hypothesis-profile=property_based tests/property_based/

# Run with custom hypothesis settings
pytest --hypothesis-max-examples=200 --hypothesis-verbosity=verbose tests/property_based/
```

## Configuration

### Hypothesis Settings

The property-based tests use a custom hypothesis profile with these settings:

```python
settings.register_profile(
    "property_based",
    max_examples=100,           # Number of test cases per property
    phases=[Phase.generate, Phase.target],  # Generation phases
    verbosity=Verbosity.verbose, # Detailed output
    deadline=1000,            # 1 second deadline per test case
    stateful_step_count=50,   # Steps for stateful tests
)
```

### Custom Strategies

Several custom strategies are defined for generating valid test data:

```python
@st.composite
def valid_asset_codes(draw):
    return draw(st.sampled_from(COMMON_ASSET_CODES) | 
                st.text(min_size=1, max_size=20, alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"))

@st.composite  
def valid_sentiment_scores(draw):
    return draw(st.floats(min_value=-1.0, max_value=1.0))
```

## Integration with CI/CD

### GitHub Actions Example

```yaml
name: Property-Based Tests
on: [push, pull_request]

jobs:
  property-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Set up Python
        uses: actions/setup-python@v2
        with:
          python-version: '3.9'
      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install hypothesis pytest
      - name: Run property-based tests
        run: |
          python tests/property_based/run_property_tests.py --report property-test-report.md
      - name: Upload test report
        uses: actions/upload-artifact@v2
        with:
          name: property-test-report
          path: property-test-report.md
```

### Pre-commit Hook

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: property-based-tests
        name: Property-based tests
        entry: python tests/property_based/run_property_tests.py --max-examples 50
        language: system
        pass_filenames: false
        always_run: true
```

## Best Practices

### Writing New Property-Based Tests

1. **Identify Clear Invariants**: Focus on properties that must always be true
2. **Use Descriptive Names**: Test names should clearly state the invariant
3. **Provide Good Strategies**: Generate realistic and edge-case data
4. **Handle Shrinking Well**: Ensure failing examples can be minimized
5. **Document Invariants**: Explain why each invariant is important

### Example Test Structure

```python
@given(st.text(min_size=1, max_size=1000))
def test_sentiment_score_bounds_invariant(self, text):
    """
    INVARIANT: Sentiment compound scores must always be between -1 and 1.
    
    This is a fundamental protocol invariant - no matter what text is
    analyzed, the compound score should never exceed these bounds.
    """
    result = analyzer.analyze(text)
    
    # Core invariant: sentiment scores must be bounded
    assert -1.0 <= result.compound_score <= 1.0, (
        f"Sentiment score {result.compound_score} outside bounds [-1, 1] "
        f"for text: {text[:100]}..."
    )
```

### Performance Considerations

1. **Set Appropriate Limits**: Use reasonable max_examples values
2. **Use Deadlines**: Set timeouts to prevent infinite loops
3. **Filter Invalid Inputs**: Use `assume()` to skip invalid test cases
4. **Optimize Strategies**: Generate data efficiently

## Troubleshooting

### Common Issues

1. **Tests Too Slow**: Reduce max_examples or optimize data generation
2. **Too Many Failures**: Check if invariants are correctly defined
3. **Flaky Tests**: Ensure tests don't depend on external state
4. **Memory Issues**: Use streaming strategies for large data

### Debugging Failed Tests

When a property-based test fails, Hypothesis will provide a minimal failing example:

```bash
Falsifying example: test_sentiment_score_bounds_invariant(text="special text")
```

Use this example to debug the issue and fix the invariant violation.

### Increasing Verbosity

```bash
# See detailed test generation
pytest --hypothesis-verbosity=verbose tests/property_based/

# See hypothesis statistics
pytest --hypothesis-show-statistics tests/property_based/
```

## Future Enhancements

### Planned Additions

1. **State Machine Testing**: Test complex stateful protocols
2. **Cross-Protocol Invariants**: Test invariants across different protocols
3. **Performance Invariants**: Test performance characteristics
4. **Security Invariants**: Enhanced security property testing
5. **Contract Testing**: Test API contract invariants

### Integration Opportunities

1. **Fuzzing Integration**: Combine with fuzzing for security testing
2. **Model-Based Testing**: Test system behavior models
3. **Formal Verification**: Integrate with formal methods
4. **Continuous Monitoring**: Run invariants in production safely

## Conclusion

Property-based testing provides a powerful way to ensure protocol-level invariants are never violated. By automatically generating comprehensive test cases, it can discover edge cases and boundary conditions that traditional testing might miss.

The implementation described here provides a solid foundation for maintaining system reliability and preventing protocol violations as the LumenPulse system evolves.

Regular execution of these tests, especially in CI/CD pipelines, helps ensure that any changes to the system maintain the critical invariants that keep the system functioning correctly.
