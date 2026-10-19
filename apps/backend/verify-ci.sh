#!/bin/bash

# CI Verification Script
# Run this before pushing to ensure all CI checks pass locally

set -e  # Exit on any error

echo "================================"
echo "Running CI Verification Checks"
echo "================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track if any check fails
FAILED=0

# Function to print status
print_status() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✓ $2 passed${NC}"
    else
        echo -e "${RED}✗ $2 failed${NC}"
        FAILED=1
    fi
}

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}node_modules not found. Installing dependencies...${NC}"
    npm install
    echo ""
fi

# 1. Lint Check
echo "1/4 Running lint..."
npm run lint > /dev/null 2>&1
print_status $? "Lint"
echo ""

# 2. Type Check
echo "2/4 Running type check..."
npx tsc --noEmit > /dev/null 2>&1
print_status $? "Type check"
echo ""

# 3. Run Tests
echo "3/4 Running tests..."
npm run test -- --passWithNoTests > /dev/null 2>&1
print_status $? "Tests"
echo ""

# 4. Build Check
echo "4/4 Running build..."
npm run build > /dev/null 2>&1
print_status $? "Build"
echo ""

# Final result
echo "================================"
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All CI checks passed! ✓${NC}"
    echo "You can safely push to GitHub."
    exit 0
else
    echo -e "${RED}Some CI checks failed! ✗${NC}"
    echo "Please fix the errors before pushing."
    exit 1
fi
