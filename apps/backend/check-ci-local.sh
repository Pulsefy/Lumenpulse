#!/bin/bash

# Comprehensive CI Check Script
# Mimics the exact checks that GitHub Actions will run
# Run this before pushing to catch issues locally

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║     Backend CI Checks - Local Verification                ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

FAILED=0
WARNINGS=0

# Check if we're in the backend directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: Must be run from apps/backend directory${NC}"
    exit 1
fi

# Check for node_modules
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}⚠ Dependencies not installed${NC}"
    echo -e "${BLUE}Running: npm install${NC}"
    npm install || { echo -e "${RED}✗ npm install failed${NC}"; exit 1; }
    echo ""
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${BLUE}CHECK 1/5: Linting${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if npm run lint 2>&1 | tee /tmp/lint-output.log; then
    echo -e "${GREEN}✓ Lint passed${NC}"
else
    echo -e "${RED}✗ Lint failed${NC}"
    echo "See errors above or in /tmp/lint-output.log"
    FAILED=1
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${BLUE}CHECK 2/5: TypeScript Type Check${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if npx tsc --noEmit 2>&1 | tee /tmp/tsc-output.log; then
    echo -e "${GREEN}✓ Type check passed${NC}"
else
    echo -e "${RED}✗ Type check failed${NC}"
    echo "See errors above or in /tmp/tsc-output.log"
    FAILED=1
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${BLUE}CHECK 3/5: Unit Tests${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if npm run test -- --passWithNoTests --silent 2>&1 | tee /tmp/test-output.log; then
    echo -e "${GREEN}✓ Tests passed${NC}"
    
    # Check test count
    TEST_COUNT=$(grep -oP '\d+ passed' /tmp/test-output.log | grep -oP '\d+' | head -1)
    if [ ! -z "$TEST_COUNT" ]; then
        echo -e "  ${GREEN}$TEST_COUNT tests passed${NC}"
    fi
else
    echo -e "${RED}✗ Tests failed${NC}"
    echo "See errors above or in /tmp/test-output.log"
    FAILED=1
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${BLUE}CHECK 4/5: Build${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if npm run build 2>&1 | tee /tmp/build-output.log; then
    echo -e "${GREEN}✓ Build passed${NC}"
else
    echo -e "${RED}✗ Build failed${NC}"
    echo "See errors above or in /tmp/build-output.log"
    FAILED=1
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${BLUE}CHECK 5/5: Moderation Event Tests Specifically${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if npm run test -- moderation-event --passWithNoTests 2>&1 | tee /tmp/moderation-test-output.log; then
    echo -e "${GREEN}✓ Moderation event tests passed${NC}"
else
    echo -e "${RED}✗ Moderation event tests failed${NC}"
    echo "See errors above or in /tmp/moderation-test-output.log"
    FAILED=1
fi
echo ""

echo "╔════════════════════════════════════════════════════════════╗"
echo "║                    FINAL RESULTS                           ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}┌──────────────────────────────────────────────────────────┐${NC}"
    echo -e "${GREEN}│  ✓ ALL CHECKS PASSED                                     │${NC}"
    echo -e "${GREEN}│                                                          │${NC}"
    echo -e "${GREEN}│  Your code is ready to push to GitHub!                  │${NC}"
    echo -e "${GREEN}│  CI checks should pass on the remote server.            │${NC}"
    echo -e "${GREEN}└──────────────────────────────────────────────────────────┘${NC}"
    echo ""
    exit 0
else
    echo -e "${RED}┌──────────────────────────────────────────────────────────┐${NC}"
    echo -e "${RED}│  ✗ SOME CHECKS FAILED                                    │${NC}"
    echo -e "${RED}│                                                          │${NC}"
    echo -e "${RED}│  Please fix the errors above before pushing.            │${NC}"
    echo -e "${RED}│  DO NOT use --no-verify to bypass these checks!         │${NC}"
    echo -e "${RED}└──────────────────────────────────────────────────────────┘${NC}"
    echo ""
    echo "Logs saved to /tmp/*-output.log for detailed review"
    echo ""
    exit 1
fi
