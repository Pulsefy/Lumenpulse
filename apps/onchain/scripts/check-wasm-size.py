#!/usr/bin/env python3
"""Check optimized Soroban WASM artifacts against per-contract budgets."""

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path


def read_sizes(artifact_dir, contracts):
    sizes = {}
    for name in contracts:
        path = Path(artifact_dir) / f"{name.replace('-', '_')}.wasm"
        if not path.is_file():
            raise ValueError(f"missing WASM artifact for {name}: {path}")
        sizes[name] = path.stat().st_size
    return sizes


def markdown(current, budgets, base=None):
    lines = ["## Contract WASM size", "", "| Contract | Size | Budget | Delta |", "| --- | ---: | ---: | ---: |"]
    for name in sorted(current):
        delta = "n/a" if base is None else f"{current[name] - base[name]:+,} bytes"
        lines.append(f"| `{name}` | {current[name]:,} bytes | {budgets[name]:,} bytes | {delta} |")
    return "\n".join(lines) + "\n"


def sizes_for_revision(repo_root, revision, onchain_dir, contracts):
    with tempfile.TemporaryDirectory() as directory:
        worktree = Path(directory) / "base"
        subprocess.run(["git", "worktree", "add", "--detach", str(worktree), revision], cwd=repo_root, check=True)
        try:
            base_onchain = worktree / onchain_dir.relative_to(repo_root)
            subprocess.run(
                ["cargo", "build", "--target", "wasm32-unknown-unknown", "--release"],
                cwd=base_onchain,
                check=True,
            )
            return read_sizes(base_onchain / "target/wasm32-unknown-unknown/release", contracts)
        finally:
            subprocess.run(["git", "worktree", "remove", "--force", str(worktree)], cwd=repo_root, check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="wasm-size-budgets.json")
    parser.add_argument("--artifact-dir", default="target/wasm32-unknown-unknown/release")
    parser.add_argument("--report", default="wasm-size-report.md")
    parser.add_argument("--compare-ref")
    parser.add_argument("--repo-root", default=".")
    args = parser.parse_args()

    onchain_dir = Path(__file__).resolve().parent.parent
    repo_root = Path(args.repo_root).resolve()
    config = json.loads((onchain_dir / args.config).read_text())
    contracts = config["contracts"]
    budgets = {name: entry.get("max_bytes", config["max_bytes"]) for name, entry in contracts.items()}
    current = read_sizes(onchain_dir / args.artifact_dir, contracts)
    base = None
    if args.compare_ref:
        base = sizes_for_revision(repo_root.parent.parent, args.compare_ref, onchain_dir, contracts)

    report = markdown(current, budgets, base)
    Path(args.report).write_text(report)
    failures = [f"{name}: {current[name]:,} > {budgets[name]:,} bytes" for name in current if current[name] > budgets[name]]
    if failures:
        print("WASM size budget exceeded:", file=sys.stderr)
        print("\n".join(failures), file=sys.stderr)
        return 1
    print(report, end="")
    return 0


if __name__ == "__main__":
    sys.exit(main())