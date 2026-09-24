#!/bin/bash

# Array of allowed crates and their reasons
# format: "crate_name:reason"
ALLOWLIST=(
  "tests:Integration tests workspace, not a contract crate"
)

has_test_module() {
  local dir=$1
  # Check if there is a 'tests' directory
  if [ -d "$dir/tests" ]; then
    return 0
  fi
  
  # Check if there is any file containing #[cfg(test)]
  if grep -rq "cfg(test)" "$dir/src" 2>/dev/null; then
    return 0
  fi
  
  return 1
}

FAILED=0

echo "Checking contract crates for test modules..."

# Assuming script is run from apps/onchain
# The glob should find all Cargo.toml files in the contracts directory
for crate_toml in contracts/*/Cargo.toml; do
  crate_dir=$(dirname "$crate_toml")
  crate_name=$(basename "$crate_dir")

  # Check if in allowlist
  allowed=0
  for item in "${ALLOWLIST[@]}"; do
    allowed_name="${item%%:*}"
    allowed_reason="${item#*:}"
    if [ "$crate_name" == "$allowed_name" ]; then
      echo "✅ $crate_name is exempt: $allowed_reason"
      allowed=1
      break
    fi
  done

  if [ $allowed -eq 1 ]; then
    continue
  fi

  if has_test_module "$crate_dir"; then
    echo "✅ $crate_name has tests"
  else
    echo "❌ ERROR: Crate '$crate_name' has no test module."
    echo "   To resolve: Add a tests/ directory, or a #[cfg(test)] module to your src/ code."
    echo "   If this crate is legitimately exempt (pure type or interface definition), add it to the ALLOWLIST in scripts/check-contract-tests.sh."
    FAILED=1
  fi
done

if [ $FAILED -ne 0 ]; then
  echo "Check failed!"
  exit 1
else
  echo "All contract checks passed!"
  exit 0
fi
