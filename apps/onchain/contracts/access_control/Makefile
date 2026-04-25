.PHONY: build build-release test test-verbose clean help audit fmt

# Default target
help:
	@echo "Access Control Contract - Available targets:"
	@echo "  make build          - Build contract in debug mode"
	@echo "  make build-release  - Build contract in release mode"
	@echo "  make test           - Run tests"
	@echo "  make test-verbose   - Run tests with output"
	@echo "  make audit          - Run security audit (cargo audit)"
	@echo "  make fmt            - Format code"
	@echo "  make fmt-check      - Check code formatting"
	@echo "  make clean          - Clean build artifacts"

# Build targets
build:
	cargo build --target wasm32-unknown-unknown

build-release:
	cargo build --target wasm32-unknown-unknown --release

# Testing
test:
	cargo test --lib

test-verbose:
	cargo test --lib -- --nocapture

# Code quality
fmt:
	cargo fmt

fmt-check:
	cargo fmt -- --check

audit:
	cargo audit

# Cleanup
clean:
	cargo clean
	rm -f target/wasm32-unknown-unknown/release/*.wasm

# All checks before deployment
all-checks: fmt-check test audit
	@echo "✓ All checks passed!"
