use error_registry::{
    assert_contract_code_in_range, code_to_message, common, common_error_description,
    contract_error_code, generate_error_reference, get_registered_error, message_to_code,
    resolve_code_from_message, resolve_error_code, resolve_error_message, ContractId,
};
use std::collections::HashSet;

/// Acceptance Criteria: Tests assert every registered code is unique across all contracts.
#[test]
fn test_every_registered_code_is_unique_across_all_contracts() {
    let reference = generate_error_reference();
    assert!(
        !reference.is_empty(),
        "Generated reference should not be empty"
    );

    let mut seen_codes = HashSet::new();
    for entry in &reference {
        assert!(
            seen_codes.insert(entry.code),
            "Duplicate registered error code {} detected for contract '{}' (variant '{}')",
            entry.code,
            entry.contract,
            entry.variant
        );
    }

    // Also assert that allocated 1000-code ranges never collide across any contracts
    let mut range_codes = HashSet::new();
    for contract in ContractId::all() {
        let base = contract.base_code();
        for offset in 0..1000 {
            let code = base + offset;
            assert!(
                range_codes.insert(code),
                "Range overlap at code {} for contract '{}'",
                code,
                contract.name()
            );
        }
    }
}

/// Acceptance Criteria: A code added outside its contract's allocated range fails a test.
#[test]
fn test_code_outside_contract_allocated_range_fails() {
    for contract in ContractId::all() {
        let base = contract.base_code();
        let (range_start, range_end) = contract.allocated_range();
        assert_eq!(range_start, base);
        assert_eq!(range_end, base + 1000);

        // Codes within range [base, base + 1000) are valid
        assert!(contract.is_valid_code(base));
        assert!(contract.is_valid_code(base + 1));
        assert!(contract.is_valid_code(base + 999));
        contract.assert_code_in_range(base);
        assert_contract_code_in_range(*contract, base + 999);

        // Codes below base are outside range
        if base > 0 {
            assert!(
                !contract.is_valid_code(base - 1),
                "Code {} should be outside allocated range for contract '{}'",
                base - 1,
                contract.name()
            );
        }

        // Codes at or above base + 1000 are outside range
        assert!(
            !contract.is_valid_code(base + 1000),
            "Code {} should be outside allocated range for contract '{}'",
            base + 1000,
            contract.name()
        );
        assert!(
            !contract.is_valid_code(base + 2000),
            "Code {} should be outside allocated range for contract '{}'",
            base + 2000,
            contract.name()
        );

        // A code computed with an offset >= 1000 via contract_error_code! falls outside range
        let out_of_range_code = contract_error_code!(*contract, 1000);
        assert!(
            !contract.is_valid_code(out_of_range_code),
            "contract_error_code with offset 1000 must not be considered valid for contract '{}'",
            contract.name()
        );
    }
}

/// Acceptance Criteria: A code added outside its contract's allocated range fails a test (panic check).
#[test]
#[should_panic(expected = "outside allocated range")]
fn test_code_added_outside_allocated_range_panics_below_base() {
    assert_contract_code_in_range(ContractId::Treasury, 1999);
}

/// Acceptance Criteria: A code added outside its contract's allocated range fails a test (panic check).
#[test]
#[should_panic(expected = "outside allocated range")]
fn test_code_added_outside_allocated_range_panics_above_base() {
    assert_contract_code_in_range(ContractId::Treasury, 3000);
}

/// Acceptance Criteria: The generated reference matches the registry exactly, asserted by test.
#[test]
fn test_generated_reference_matches_registry_exactly() {
    let reference = generate_error_reference();
    let contracts = ContractId::all();

    // 22 contracts * 3 common errors = 66 entries
    let expected_count = contracts.len() * 3;
    assert_eq!(
        reference.len(),
        expected_count,
        "Generated reference entry count ({}) must match expected registry count ({})",
        reference.len(),
        expected_count
    );

    for entry in &reference {
        // Must match lookup in registry
        let registry_entry = get_registered_error(entry.code)
            .unwrap_or_else(|| panic!("Code {} must be registered in the registry", entry.code));
        assert_eq!(
            *entry, registry_entry,
            "Generated reference entry for code {} does not match registry entry",
            entry.code
        );

        // Must match resolve_error_code
        let (resolved_contract, variant) = resolve_error_code(entry.code)
            .unwrap_or_else(|| panic!("Code {} must resolve to contract and variant", entry.code));
        assert_eq!(resolved_contract, entry.contract);

        // Description must match common_error_description
        let expected_desc = common_error_description(variant)
            .unwrap_or_else(|| panic!("Variant {} must have common error description", variant));
        assert_eq!(entry.description, expected_desc);

        // Must belong to the contract's range
        let contract = contracts
            .iter()
            .find(|c| c.name() == entry.contract)
            .unwrap_or_else(|| {
                panic!(
                    "Contract '{}' not found in ContractId::all()",
                    entry.contract
                )
            });
        assert!(contract.is_valid_code(entry.code));
    }

    // Verify every contract has each common error variant in the generated reference
    for contract in contracts {
        let base = contract.base_code();
        let expected_variants = [
            (
                common::NOT_INITIALIZED,
                "NotInitialized",
                "Contract has not been initialized",
            ),
            (
                common::ALREADY_INITIALIZED,
                "AlreadyInitialized",
                "Contract has already been initialized",
            ),
            (
                common::UNAUTHORIZED,
                "Unauthorized",
                "Caller is not authorized for this operation",
            ),
        ];

        for (variant_offset, variant_name, desc) in expected_variants {
            let expected_code = base + variant_offset;
            let found = reference.iter().find(|e| e.code == expected_code);
            assert!(
                found.is_some(),
                "Reference missing entry for contract '{}', variant '{}', code {}",
                contract.name(),
                variant_name,
                expected_code
            );
            let found_entry = found.unwrap();
            assert_eq!(found_entry.contract, contract.name());
            assert_eq!(found_entry.variant, variant_name);
            assert_eq!(found_entry.description, desc);
            assert!(found_entry.is_common);
        }
    }
}

/// Acceptance Criteria: Round-tripping a code to its message and back is covered.
#[test]
fn test_round_tripping_code_to_message_and_back() {
    let reference = generate_error_reference();

    for entry in &reference {
        // Method 1: resolve_error_message and resolve_code_from_message
        let resolved_msg = resolve_error_message(entry.code)
            .unwrap_or_else(|| panic!("Failed to resolve message for code {}", entry.code));
        assert_eq!(resolved_msg, entry.description);

        let recovered_code_from_desc = resolve_code_from_message(entry.contract, resolved_msg)
            .unwrap_or_else(|| {
                panic!(
                    "Failed to recover code from description for contract '{}'",
                    entry.contract
                )
            });
        assert_eq!(
            recovered_code_from_desc, entry.code,
            "Round-tripped code does not match original code for contract '{}'",
            entry.contract
        );

        // Also round-trip using variant name
        let recovered_code_from_variant = resolve_code_from_message(entry.contract, entry.variant)
            .unwrap_or_else(|| {
                panic!(
                    "Failed to recover code from variant for contract '{}'",
                    entry.contract
                )
            });
        assert_eq!(recovered_code_from_variant, entry.code);

        // Method 2: code_to_message and message_to_code (fully qualified)
        let qualified_msg = code_to_message(entry.code).unwrap_or_else(|| {
            panic!("Failed to format qualified message for code {}", entry.code)
        });
        let expected_qualified = format!("{}: {}", entry.contract, entry.description);
        assert_eq!(qualified_msg, expected_qualified);

        let recovered_code = message_to_code(&qualified_msg).unwrap_or_else(|| {
            panic!(
                "Failed to recover code from qualified message '{}'",
                qualified_msg
            )
        });
        assert_eq!(
            recovered_code, entry.code,
            "Qualified round-trip failed for code {}",
            entry.code
        );
    }

    // Negative round-trip cases
    assert_eq!(resolve_error_message(999999), None);
    assert_eq!(code_to_message(999999), None);
    assert_eq!(
        resolve_code_from_message("unknown_contract", "Contract has not been initialized"),
        None
    );
    assert_eq!(
        resolve_code_from_message("treasury", "Unknown error description"),
        None
    );
    assert_eq!(
        message_to_code("unknown_contract: Contract has not been initialized"),
        None
    );
    assert_eq!(message_to_code("invalid format without colon"), None);
}

/// Additional conformance checks: macro usage and range boundaries.
#[test]
fn test_contract_error_code_allocations_and_boundaries() {
    for contract in ContractId::all() {
        let base = contract.base_code();
        assert_eq!(contract_error_code!(*contract, 0), base);
        assert_eq!(contract_error_code!(*contract, 1), base + 1);
        assert_eq!(contract_error_code!(*contract, 2), base + 2);
        assert_eq!(contract_error_code!(*contract, 500), base + 500);
        assert_eq!(contract_error_code!(*contract, 999), base + 999);
    }
}
