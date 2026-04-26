"""
Simple property-based tests to verify the framework works.

These tests don't depend on complex external modules and demonstrate
the property-based testing functionality.
"""

import pytest
from hypothesis import given, strategies as st, assume


class TestSimpleInvariants:
    """Simple property-based tests for basic invariants."""
    
    @given(st.integers(min_value=-100, max_value=100))
    def test_integer_addition_commutativity_invariant(self, a):
        """
        INVARIANT: Integer addition is commutative.
        
        a + b == b + a for all integers a, b
        """
        b = 42  # Fixed second operand
        assert a + b == b + a, f"Addition not commutative: {a} + {b} != {b} + {a}"
    
    @given(st.integers(min_value=-100, max_value=100))
    def test_integer_addition_identity_invariant(self, a):
        """
        INVARIANT: Adding zero preserves the value.
        
        a + 0 == a for all integers a
        """
        assert a + 0 == a, f"Adding zero changed value: {a} + 0 != {a}"
    
    @given(st.text(min_size=1, max_size=100))
    def test_string_length_invariant(self, text):
        """
        INVARIANT: String length is non-negative.
        
        len(s) >= 0 for all strings s
        """
        length = len(text)
        assert length >= 0, f"String length should be non-negative: {length}"
        assert length >= 1, f"String should have at least 1 character: {length}"
    
    @given(st.lists(st.integers(min_value=0, max_value=100), min_size=0, max_size=50))
    def test_list_sum_bounds_invariant(self, numbers):
        """
        INVARIANT: Sum of non-negative numbers is non-negative.
        
        sum([x1, x2, ..., xn]) >= 0 for all xi >= 0
        """
        total = sum(numbers)
        assert total >= 0, f"Sum of non-negative numbers should be non-negative: {total}"
        
        # Also check that sum doesn't exceed reasonable bounds
        max_possible = len(numbers) * 100
        assert total <= max_possible, f"Sum {total} exceeds max possible {max_possible}"
    
    @given(st.text(min_size=1, max_size=50), st.text(min_size=1, max_size=50))
    def test_string_concatenation_length_invariant(self, a, b):
        """
        INVARIANT: String concatenation length equals sum of individual lengths.
        
        len(a + b) == len(a) + len(b) for all strings a, b
        """
        concatenated = a + b
        expected_length = len(a) + len(b)
        actual_length = len(concatenated)
        
        assert actual_length == expected_length, (
            f"Length invariant violated: len('{a}' + '{b}') = {actual_length}, "
            f"expected {expected_length}"
        )
    
    @given(st.lists(st.integers(min_value=-100, max_value=100), min_size=0, max_size=20))
    def test_list_sorting_invariant(self, numbers):
        """
        INVARIANT: Sorting preserves the multiset of elements.
        
        sorted(list) contains exactly the same elements as the original list
        """
        sorted_numbers = sorted(numbers)
        
        # Check that both lists have the same length
        assert len(sorted_numbers) == len(numbers), (
            f"Sorting changed list length: {len(numbers)} -> {len(sorted_numbers)}"
        )
        
        # Check that both lists have the same multiset of elements
        from collections import Counter
        original_counter = Counter(numbers)
        sorted_counter = Counter(sorted_numbers)
        
        assert original_counter == sorted_counter, (
            f"Sorting changed element multiset: {original_counter} != {sorted_counter}"
        )
    
    @given(st.integers(min_value=1, max_value=1000), st.integers(min_value=1, max_value=1000))
    def test_multiplication_commutativity_invariant(self, a, b):
        """
        INVARIANT: Integer multiplication is commutative.
        
        a * b == b * a for all integers a, b
        """
        assert a * b == b * a, f"Multiplication not commutative: {a} * {b} != {b} * {a}"
    
    @given(st.integers(min_value=-100, max_value=100))
    def test_multiplication_identity_invariant(self, a):
        """
        INVARIANT: Multiplying by one preserves the value.
        
        a * 1 == a for all integers a
        """
        assert a * 1 == a, f"Multiplying by one changed value: {a} * 1 != {a}"
    
    @given(st.integers(min_value=-100, max_value=100))
    def test_multiplication_by_zero_invariant(self, a):
        """
        INVARIANT: Multiplying by zero gives zero.
        
        a * 0 == 0 for all integers a
        """
        assert a * 0 == 0, f"Multiplying by zero should give zero: {a} * 0 != 0"


class TestBoundaryInvariants:
    """Tests that verify boundary condition invariants."""
    
    @given(st.integers(min_value=0, max_value=100))
    def test_square_root_bounds_invariant(self, n):
        """
        INVARIANT: Square root is bounded by input for non-negative numbers.
        
        sqrt(n) <= n for all n >= 1, and sqrt(0) = 0
        """
        import math
        
        if n == 0:
            assert math.sqrt(n) == 0, f"sqrt(0) should be 0"
        else:
            sqrt_n = math.sqrt(n)
            assert sqrt_n <= n, f"sqrt({n}) = {sqrt_n} should be <= {n}"
            assert sqrt_n >= 0, f"sqrt({n}) = {sqrt_n} should be >= 0"
    
    @given(st.integers(min_value=1, max_value=100))
    def test_division_bounds_invariant(self, n):
        """
        INVARIANT: Division by larger number gives result less than 1.
        
        n / m < 1 for all n, m > 0 where m > n
        """
        m = n + 1  # Ensure m > n
        result = n / m
        
        assert 0 < result < 1, f"{n} / {m} = {result} should be between 0 and 1"
    
    @given(st.integers(min_value=1, max_value=50))
    def test_factorial_growth_invariant(self, n):
        """
        INVARIANT: Factorial grows faster than exponential.
        
        n! > 2^n for all n >= 4
        """
        import math
        
        if n >= 4:
            factorial = math.factorial(n)
            exponential = 2 ** n
            assert factorial > exponential, f"{n}! = {factorial} should be > 2^{n} = {exponential}"


class TestDataStructureInvariants:
    """Tests for data structure invariants."""
    
    @given(st.dictionaries(keys=st.text(min_size=1, max_size=10), values=st.integers(), min_size=0, max_size=20))
    def test_dictionary_keys_invariant(self, d):
        """
        INVARIANT: Dictionary keys are unique.
        
        All keys in a dictionary should be unique
        """
        keys = list(d.keys())
        unique_keys = set(keys)
        
        assert len(keys) == len(unique_keys), (
            f"Dictionary should have unique keys: found {len(keys)} keys, "
            f"but only {len(unique_keys)} unique keys"
        )
    
    @given(st.sets(st.integers(min_value=0, max_value=100), min_size=0, max_size=20))
    def test_set_uniqueness_invariant(self, s):
        """
        INVARIANT: Set elements are unique.
        
        All elements in a set should be unique
        """
        elements = list(s)
        unique_elements = set(elements)
        
        assert len(elements) == len(unique_elements), (
            f"Set should have unique elements: found {len(elements)} elements, "
            f"but only {len(unique_elements)} unique elements"
        )
    
    @given(st.lists(st.integers(min_value=0, max_value=100), min_size=0, max_size=20))
    def test_list_reversal_invariant(self, lst):
        """
        INVARIANT: Reversing a list twice returns the original list.
        
        reverse(reverse(lst)) == lst for all lists lst
        """
        reversed_once = list(reversed(lst))
        reversed_twice = list(reversed(reversed_once))
        
        assert lst == reversed_twice, (
            f"Double reversal should return original list: {lst} != {reversed_twice}"
        )


if __name__ == "__main__":
    # Run tests directly
    pytest.main([__file__, "-v"])
