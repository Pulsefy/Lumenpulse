# Mainnet Readiness

This document collects the figures and checks needed before the Lumenpulse
contract suite is deployed to Stellar mainnet. Operational procedure lives in
the [Contract Deployment & Rollback Playbook](CONTRACT_DEPLOYMENT_ROLLBACK_PLAYBOOK.md) and the
[Contract Mainnet Readiness Checklist](./MAINNET_READINESS_CHECKLIST.md);
this page records what deployment **costs** and what must be true for it to succeed.

---

## 1. Deployment cost

### 1.1 What is measured

Deploying a contract is two transactions:

| Step | Operation | Cost driver |
| --- | --- | --- |
| Upload | `UploadContractWasm` | Size of the code ledger entry: write bytes, transaction size, rent for the new entry, and the instructions spent parsing the module |
| Create | `CreateContract` | One small instance entry, effectively constant |

Initialization (`initialize` calls) is **not** included. It is an ordinary
contract invocation whose cost depends on the arguments and the state each
contract writes, and it is a small fraction of the upload cost.

The suite is every contract that has a deployed `id` in
[`apps/onchain/testnet-manifest.json`](../apps/onchain/testnet-manifest.json):
`contributor_registry`, `crowdfund_vault`, `lumen_token`, `matching_pool`,
`pricing_adapter`, `project_registry` and `treasury`.

### 1.2 Baseline and result

Fees actually charged on **testnet**, measured with `--execute` on
2026-10-15 (protocol 29, ledger 5212166). Raw data:
[`apps/onchain/deploy-cost-baseline.json`](../apps/onchain/deploy-cost-baseline.json).

| Contract | Baseline size | Baseline (XLM) | Optimized size | Optimized (XLM) | Saving (XLM) | Share of suite |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| crowdfund_vault | 112,267 B | 53.7363 | 91,301 B | 38.9998 | 14.7366 | 31.7% |
| contributor_registry | 64,163 B | 29.8868 | 50,946 B | 20.1598 | 9.7270 | 16.4% |
| treasury | 55,732 B | 28.5090 | 44,086 B | 20.0253 | 8.4837 | 16.3% |
| matching_pool | 53,257 B | 28.0797 | 40,694 B | 19.1590 | 8.9207 | 15.6% |
| project_registry | 35,441 B | 18.4475 | 25,784 B | 11.4990 | 6.9485 | 9.3% |
| lumen_token | 18,424 B | 10.8285 | 14,854 B | 7.7945 | 3.0340 | 6.3% |
| pricing_adapter | 10,978 B | 5.7426 | 10,571 B | 5.4611 | 0.2815 | 4.4% |
| **Suite total** | **350,262 B** | **175.2305** | **278,236 B** | **123.0985** | **52.1320 (29.8%)** | 100% |

Each `CreateContract` costs about 0.0077 XLM, so almost the entire cost is the
WASM upload, and it tracks binary size. `crowdfund_vault` alone is close to a
third of the suite, and the four largest contracts make up about 80%.

**Mainnet estimate.** Simulating the same uploads against a mainnet RPC
(nothing submitted, same date) gives **483.83 XLM** for the baseline and
**339.84 XLM** optimized, a saving of **143.99 XLM** per suite deployment.
Simulation quotes the maximum resource fee, including the refundable part. On
testnet the simulated figure came out about 15% higher than the fee actually
charged (201.37 vs 175.23 XLM), so budget for the simulated number and expect
to pay somewhat less. Raw data:
[`apps/onchain/deploy-cost-mainnet-estimate.json`](../apps/onchain/deploy-cost-mainnet-estimate.json).

Mainnet is about 2.8× testnet because the networks have different fee and
rent settings. Re-measure right before deploying, because validators can
change these settings.

### 1.3 The reduction: optimize WASM before upload

`scripts/optimize-wasm.mjs` runs binaryen (the library behind `wasm-opt`) at
`-Oz` over every release WASM and writes the output to
`apps/onchain/target/wasm32-unknown-unknown/release/optimized/`.
`scripts/deploy.ts` now uploads from that directory.

- **Saving:** 52.13 XLM per testnet suite deployment (29.8%), and an estimated
  ~144 XLM on mainnet. Every contract gets smaller (−4% to −27% bytes vs. baseline).
- **Behaviour:** optimization preserves semantics, and the `contractspecv0`
  interface section is kept byte-for-byte. Optimized `lumen_token`,
  `contributor_registry` and `crowdfund_vault` were deployed to testnet and
  exercised: initialize, mint/balance, register/read-back, and a duplicate
  registration returning the typed `ContributorAlreadyExists` error.
- **Reproducibility:** binaryen is pinned to an exact version (`132.0.0`) in
  `scripts/package.json` and `package-lock.json`, and it runs as WebAssembly,
  so the same raw input gives the same optimized bytes on every machine.

The "baseline" column is the raw build re-emitted with MVP features and **no**
optimization passes. That is the smallest change that makes the raw build
deployable (see §2.1), so the saving above comes from optimization alone.

### 1.4 Re-measuring

```bash
# From the repo root
cargo build --manifest-path apps/onchain/Cargo.toml --target wasm32-unknown-unknown --release
npm ci --prefix scripts
npm run --prefix scripts wasm:optimize -- --baseline

# Simulate only: free, no secrets, nothing submitted (upload cost only)
npm run --prefix scripts deploy:cost

# Fees actually charged on testnet (friendbot-funded throwaway account)
npm run --prefix scripts deploy:cost -- --execute --artifacts baseline,optimized \
  --json ../apps/onchain/deploy-cost-baseline.json

# Mainnet estimate (simulation only, nothing submitted)
SOROBAN_RPC_URL=https://mainnet.sorobanrpc.com \
NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015" \
npm run --prefix scripts deploy:cost -- --artifacts baseline,optimized \
  --json ../apps/onchain/deploy-cost-mainnet-estimate.json
```

Flags: `--artifacts raw,baseline,optimized` (any subset), `--all` (every built
contract, not just the deployed suite), `--json <path>` (write results,
relative to `scripts/`). `--execute` outside testnet needs `ADMIN_SECRET` and
**spends real XLM**.

---

## 2. Deployment blockers and checks

### 2.1 Raw cargo WASM is rejected by the network

With the pinned toolchain (Rust 1.85.0, `wasm32-unknown-unknown`), the raw
release build of 5 of the 7 suite contracts (14 of the 17 workspace contracts)
is **rejected** when uploaded:

```
reference-types not enabled: zero byte expected
```

Rust 1.82+ enables the `reference-types` WASM feature by default, and the
precompiled `core` is built with it, so `-C target-cpu=mvp` does not help.
LLVM then writes `call_indirect` table indexes in a form the Soroban VM does
not accept. `optimize-wasm.mjs` re-emits every module with only MVP features
enabled, which fixes the encoding. **Always deploy from `release/optimized/`.**
CI now runs the optimizer on every onchain change, so a module binaryen cannot
lower fails the build.

Run `npm run --prefix scripts deploy:cost -- --artifacts raw` to check this
yourself. Rejected contracts are listed with the network's error.

### 2.2 Manifest hashes

`testnet-manifest.json` currently records hashes of the raw cargo output. The
first deploy made with `scripts/deploy.ts` will produce optimized hashes.
Record those, and verify them with:

```bash
node apps/onchain/scripts/verify-wasm-hashes.mjs --optimized
```

At that point, switch the CI "Verify WASM hashes against manifest" step to
`--optimized` in the same PR.

### 2.3 Checklist

- [ ] Re-run the mainnet estimate (§1.4) and fund the deployer with at least the simulated total plus initialization headroom.
- [ ] Deploy only `release/optimized/*.wasm`.
- [ ] Record the optimized hashes in the manifest and switch hash verification to `--optimized`.
- [ ] Confirm the size budgets in `apps/onchain/wasm-budgets.json` still pass (`node ../../scripts/check-wasm-size.mjs` from `apps/onchain`).
- [ ] Complete all items on the [Contract Mainnet Readiness Checklist](./MAINNET_READINESS_CHECKLIST.md) and record sign-offs in [`apps/onchain/mainnet-readiness.signoffs.json`](../apps/onchain/mainnet-readiness.signoffs.json).
