#!/usr/bin/env python3
"""
Generate a comprehensive error reference mapping from contract error enums.

This script parses all contract error enums and generates a JSON mapping of
error codes to their contract, enum, variant, and human-readable message.
"""

import json
import re
from pathlib import Path
from datetime import datetime
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


def parse_error_enum(file_path: Path) -> Tuple[str, List[Tuple[str, int, str]]]:
    """
    Parse a contract error enum file and extract (enum_name, variant_name, code, message) tuples.
    """
    content = file_path.read_text()
    
    # Extract enum name
    enum_match = re.search(r'pub enum (\w+)', content)
    if not enum_match:
        return None, []
    enum_name = enum_match.group(1)
    
    errors = []
    lines = content.split('\n')
    
    for line in lines:
        # Match error variant with code and optional comment
        match = re.match(r'\s*(\w+)\s*=\s*(\d+)(?:,\s*///?\s*(.*))?', line)
        if match:
            variant_name = match.group(1)
            code = int(match.group(2))
            message = match.group(3) or variant_name
            # Convert camelCase to readable message
            if message == variant_name:
                message = re.sub(r'([A-Z])', r' \1', variant_name).strip()
            errors.append((variant_name, code, message))
    
    return enum_name, errors


def generate_error_reference() -> Dict:
    """
    Generate the complete error reference mapping.
    """
    contracts_dir = Path(__file__).parent.parent
    output = {
        "version": "1.0.0",
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "contracts": {},
        "code_to_error": {},
        "allocation_ranges": CONTRACT_ALLOCATIONS,
    }
    
    for contract_name, (min_code, max_code) in CONTRACT_ALLOCATIONS.items():
        error_file = contracts_dir / contract_name / "src" / "errors.rs"
        
        if not error_file.exists():
            continue
        
        try:
            enum_name, errors = parse_error_enum(error_file)
            if not enum_name:
                continue
            
            contract_data = {
                "enum_name": enum_name,
                "range": [min_code, max_code],
                "errors": {},
            }
            
            for variant_name, code, message in errors:
                # Validate code is within allocated range
                if not (min_code <= code <= max_code):
                    print(f"Warning: {contract_name}::{variant_name} code {code} outside range [{min_code}, {max_code}]")
                
                # Add to contract errors
                contract_data["errors"][variant_name] = {
                    "code": code,
                    "message": message,
                }
                
                # Add to code_to_error mapping
                code_str = str(code)
                if code_str in output["code_to_error"]:
                    existing = output["code_to_error"][code_str]
                    print(f"Error: Code {code} already used by {existing['contract']}::{existing['variant']}")
                    print(f"       Now trying to assign to {contract_name}::{variant_name}")
                else:
                    output["code_to_error"][code_str] = {
                        "contract": contract_name,
                        "enum": enum_name,
                        "variant": variant_name,
                        "message": message,
                    }
            
            output["contracts"][contract_name] = contract_data
            
        except Exception as e:
            print(f"Error parsing {error_file}: {e}")
    
    return output


def main():
    """Main entry point for the script."""
    print("Generating error reference mapping...")
    
    error_reference = generate_error_reference()
    
    # Write to contracts directory
    contracts_dir = Path(__file__).parent.parent
    output_file = contracts_dir / "error_reference.json"
    
    with open(output_file, 'w') as f:
        json.dump(error_reference, f, indent=2)
    
    print(f"Generated error reference with {len(error_reference['contracts'])} contracts")
    print(f"Total error codes mapped: {len(error_reference['code_to_error'])}")
    print(f"Output written to: {output_file}")
    
    # Also write to backend directory
    backend_dir = contracts_dir.parent.parent / "backend" / "src"
    backend_output = backend_dir / "error_reference.json"
    
    if backend_dir.exists():
        with open(backend_output, 'w') as f:
            json.dump(error_reference, f, indent=2)
        print(f"Also written to: {backend_output}")


if __name__ == "__main__":
    main()
