# Testnet smoke harness

Run the deployed-contract smoke checks from the repository root:

```sh
npm install --prefix scripts
npm run smoke --prefix scripts
```

The harness reads `apps/onchain/testnet-manifest.json` (override with
`SMOKE_MANIFEST`), loads the manifest admin account, and simulates one
read-only Soroban invocation for every contract in the manifest. No
transaction is signed or submitted. `SOROBAN_RPC_URL`, `HORIZON_URL`,
`NETWORK_PASSPHRASE`, and `SMOKE_ADMIN` can override the manifest/defaults.

The only stdout line is JSON suitable for CI. `ok` is false and the process
exits non-zero when any check fails. Each failure includes both `contract` and
`check`, for example:

```json
{"ok":false,"results":[{"contract":"treasury","check":"get_admin","ok":false,"error":"..."}]}
```
