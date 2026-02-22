default: build



all: test



test: build

	cargo test



build:

	cargo build --release --target wasm32-unknown-unknown

	@ls -l target/wasm32-unknown-unknown/release/*.wasm



fmt:

	cargo fmt --all



clean:

	cargo clean

