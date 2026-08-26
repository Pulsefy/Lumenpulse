#!/usr/bin/env python3
"""
Test to detect overlapping error codes across contracts.

This test ensures that no two contracts declare overlapping error codes,
which would make error diagnosis ambiguous.
"""

import sys
import re
from pathlib import Path
from typing import Dict, List, Tuple


CONTRACT_ALLOCATIONS = {
    "contributor_registry": (100, 299),
    "crowdfund_vault": (300, 499),
    "feature_flags": (500, 599),
    "lumenpulse-curation": (600, 699),
    "matching_pool": (700, 899),
    "notification_broker": (900, 999),
    "pricing_adapter": (1000, 1099),
    "project_registry": (1100, 1199),
    "protocol_registry": (1200, 1299),
    "treasury": (1300, 1499),
    "upgradable-contract": (1500, 1599),
    "vesting-wallet": (1600, 1699),
    "yield_vault": (1700, 1799),
}


def parse_error_enum(file_path: Path) -> List[Tuple[str, int]]:
    """
    Parse a contract error enum file and extract (variant_name, code) pairs.
    """
    content = file_path.read_text()
    
    errors = []
    lines = content.split('\n')
    
    for line in lines:
        # Match error variant with code
        match = re.match(r'\s*(\w+)\s*=\s*(\d+)', line)
        if match:
            variant_name = match.group(1)
            code = int(match.group(2))
            errors.append((variant_name, code))
    
    return errors


def check_overlaps() -> Tuple[bool, List[str]]:
    """
    Check for overlapping error codes across contracts.
    
    Returns:
        (has_overlaps, list_of_error_messages)
    """
    contracts_dir = Path(__file__).parent.parent
    code_to_locations: Dict[int, List[str]] = {}
    allocation_violations = []
    
    for contract_name, (min_code, max_code) in CONTRACT_ALLOCATIONS.items():
        error_file = contracts_dir / contract_name / "src" / "errors.rs"
        
        if not error_file.exists():
            continue
        
        try:
            errors = parse_error_enum(error_file)
            
            for variant_name, code in errors:
                # Check if code is within allocated range
                if not (min_code <= code <= max_code):
                    allocation_violations.append(
                        f"Contract '{contract_name}' error '{variant_name}' has code {code} "
                        f"outside allocated range [{min_code}, {max_code}]"
                    )
                
                # Track code usage for overlap detection
                if code not in code_to_locations:
                    code_to_locations[code] = []
                code_to_locations[code].append(f"{contract_name}::{variant_name}")
                
        except Exception as e:
            print(f"Error parsing {error_file}: {e}")
            return True, [f"Failed to parse {error_file}: {e}"]
    
    # Check for overlaps
    overlaps = []
    for code, locations in code_to_locations.items():
        if len(locations) > 1:
            overlaps.append(
                f"Code {code} is used by multiple contracts: {', '.join(locations)}"
            )
    
    all_errors = overlaps + allocation_violations
    return len(all_errors) > 0, all_errors


def main():
    """Main entry point for the test."""
    print("Checking for overlapping error codes across contracts...")
    
    has_overlaps, errors = check_overlaps()
    
    if has_overlaps:
        print("❌ FAILED: Error code overlap or allocation violation detected!")
        for error in errors:
            print(f"  - {error}")
        print("\nPlease fix the overlapping codes before proceeding.")
        return 1
    else:
        print("✅ PASSED: No overlapping error codes detected.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
