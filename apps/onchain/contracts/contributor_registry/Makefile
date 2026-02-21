default: build

all: test

test: build
	cargo test

build:
	soroban contract build
	@echo "Finding WASM files:"
	@find target -name "*.wasm" -type f 2>/dev/null || echo "No WASM files found"
	@ls -la target/wasm32-unknown-unknown/release/*.wasm 2>/dev/null || ls -la target/wasm32v1-none/release/*.wasm 2>/dev/null || echo "WASM files not found in expected locations"

fmt:
	cargo fmt --all

clean:
	cargo clean
